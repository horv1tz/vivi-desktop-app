import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { join } from 'node:path'
import { net } from 'electron'
import { x as tarExtract } from 'tar'
import unbzip2 from 'unbzip2-stream'
import type { ModelDownloadProgress } from '@shared/events'
import type { VoiceModelInfo } from '@shared/ipc'
import { VOICE_MODELS, modelById, type VoiceModel } from '@shared/models'
import { logger } from '../logging/log'

const log = logger('models')

export interface ModelPaths {
  dir: string
  encoder?: string
  decoder?: string
  joiner?: string
  model?: string
  tokens?: string
  dataDir?: string
}

export class ModelManager {
  private active = new Map<string, AbortController>()

  constructor(private readonly modelsDir: string, private readonly onProgress: (p: ModelDownloadProgress) => void) {
    mkdirSync(modelsDir, { recursive: true })
  }

  dirFor(model: VoiceModel): string {
    return join(this.modelsDir, model.dir)
  }

  isInstalled(id: string): boolean {
    const m = modelById(id)
    if (!m) return false
    const dir = this.dirFor(m)
    if (!existsSync(dir)) return false
    const required = [m.files.encoder, m.files.decoder, m.files.joiner, m.files.model, m.files.tokens].filter((f): f is string => !!f)
    return required.every((f) => existsSync(join(dir, f)))
  }

  paths(id: string): ModelPaths | null {
    const m = modelById(id)
    if (!m || !this.isInstalled(id)) return null
    const dir = this.dirFor(m)
    const p = (f?: string): string | undefined => (f ? join(dir, f) : undefined)
    return { dir, encoder: p(m.files.encoder), decoder: p(m.files.decoder), joiner: p(m.files.joiner), model: p(m.files.model), tokens: m.files.tokens ? join(dir, m.files.tokens) : undefined, dataDir: p(m.files.dataDir) }
  }

  list(): VoiceModelInfo[] {
    return VOICE_MODELS.map((m) => ({ id: m.id, kind: m.kind, name: m.name, language: m.language, sizeMb: m.sizeMb, installed: this.isInstalled(m.id), description: m.description }))
  }

  delete(id: string): void {
    const m = modelById(id)
    if (!m) return
    this.active.get(id)?.abort()
    rmSync(this.dirFor(m), { recursive: true, force: true })
  }

  async download(id: string): Promise<void> {
    const m = modelById(id)
    if (!m) throw new Error(`unknown model ${id}`)
    if (this.isInstalled(id)) return
    if (this.active.has(id)) return
    const abort = new AbortController()
    this.active.set(id, abort)
    const target = this.dirFor(m)
    const tmpDir = `${target}.partial`
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
    const report = (p: Partial<ModelDownloadProgress>): void => this.onProgress({ modelId: id, receivedBytes: 0, totalBytes: 0, status: 'downloading', ...p })
    try {
      log.info(`downloading ${id} from ${m.url}`)
      const res = await net.fetch(m.url, { signal: abort.signal, redirect: 'follow' })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} while downloading ${m.name}`)
      const total = Number(res.headers.get('content-length') ?? 0) || Math.round(m.sizeMb * 1e6)
      let received = 0
      let lastReport = 0
      const counting = new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          received += chunk.byteLength
          const now = Date.now()
          if (now - lastReport > 150) {
            lastReport = now
            report({ receivedBytes: received, totalBytes: total })
          }
          controller.enqueue(chunk)
        },
      })
      const source = Readable.fromWeb(res.body.pipeThrough(counting) as unknown as NodeReadableStream<Uint8Array>)
      if (m.url.endsWith('.tar.bz2')) {
        report({ status: 'downloading', receivedBytes: 0, totalBytes: total })
        await pipeline(source, unbzip2(), tarExtract({ cwd: tmpDir, strip: 0 }))
      } else {
        const fileName = m.url.split('/').pop() ?? 'model.onnx'
        await pipeline(source, createWriteStream(join(tmpDir, fileName)))
      }
      report({ status: 'extracting', receivedBytes: received, totalBytes: total })
      // Archives extract into a single top-level folder named like the model dir; flatten it.
      const entries = readdirSync(tmpDir)
      const inner = entries.length === 1 && statSync(join(tmpDir, entries[0]!)).isDirectory() ? join(tmpDir, entries[0]!) : tmpDir
      rmSync(target, { recursive: true, force: true })
      renameSync(inner, target)
      if (inner !== tmpDir) rmSync(tmpDir, { recursive: true, force: true })
      if (!this.isInstalled(id)) throw new Error(`archive for ${m.name} did not contain the expected files: ${readdirSync(target).slice(0, 8).join(', ')}`)
      report({ status: 'done', receivedBytes: received, totalBytes: total })
      log.info(`installed ${id}`)
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true })
      const message = abort.signal.aborted ? 'cancelled' : (err as Error).message
      log.error(`download ${id} failed: ${message}`)
      report({ status: 'error', error: message })
      throw err
    } finally {
      this.active.delete(id)
    }
  }

  cancel(id: string): void {
    this.active.get(id)?.abort()
  }
}
