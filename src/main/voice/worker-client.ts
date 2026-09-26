import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron'
import type { MainToWorker, WorkerToMain } from '../../voice-worker/protocol'
import { logger } from '../logging/log'

const log = logger('voice-worker-client')

/** Supervises the voice utilityProcess: spawn, restart with backoff, typed messaging. */
export class VoiceWorkerClient extends EventEmitter {
  private proc: UtilityProcess | null = null
  private restarts = 0
  private stopping = false
  private readyPromise: Promise<void> | null = null

  constructor(private readonly opts: { entry: string; env: Record<string, string | undefined> }) {
    super()
  }

  get running(): boolean {
    return this.proc !== null
  }

  async start(): Promise<void> {
    if (this.proc) return this.readyPromise ?? Promise.resolve()
    this.stopping = false
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(this.opts.env)) if (v !== undefined) env[k] = v
    const proc = utilityProcess.fork(this.opts.entry, [], {
      serviceName: 'vivi-voice',
      stdio: 'pipe',
      env,
      allowLoadingUnsignedLibraries: true,
    })
    this.proc = proc
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('voice worker did not start')), 20_000)
      // UtilityProcess 'message' delivers the payload directly (unlike MessagePort events).
      const onMessage = (raw: unknown): void => {
        const msg = raw as WorkerToMain
        if (msg?.type === 'ready') {
          clearTimeout(timer)
          proc.off('message', onMessage)
          resolve()
        }
      }
      proc.on('message', onMessage)
    })
    proc.on('message', (raw: unknown) => {
      const msg = raw as WorkerToMain
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'log') log[msg.level](`[worker] ${msg.message}`)
      this.emit('message', msg)
    })
    proc.stdout?.on('data', (d: Buffer) => log.info(`[worker] ${d.toString().trimEnd()}`))
    proc.stderr?.on('data', (d: Buffer) => log.warn(`[worker] ${d.toString().trimEnd()}`))
    proc.on('exit', (code) => {
      log.warn(`voice worker exited with code ${code}`)
      this.proc = null
      this.readyPromise = null
      this.emit('exit', code)
      if (!this.stopping && this.restarts < 5) {
        const delay = Math.min(10_000, 500 * 2 ** this.restarts++)
        setTimeout(() => {
          if (!this.stopping)
            this.start()
              .then(() => this.emit('restarted'))
              .catch((err) => log.error('restart failed', err))
        }, delay)
      }
    })
    await this.readyPromise
    this.restarts = 0
  }

  send(msg: MainToWorker): void {
    this.proc?.postMessage(msg)
  }

  /** Creates a channel; returns the renderer-side port (the other end goes to the worker). */
  createAudioChannel(): Electron.MessagePortMain {
    const { port1, port2 } = new MessageChannelMain()
    this.proc?.postMessage({ type: 'audio-port' } satisfies MainToWorker, [port2])
    return port1
  }

  async stop(): Promise<void> {
    this.stopping = true
    const p = this.proc
    if (!p) return
    log.debug('stopping voice worker')
    p.postMessage({ type: 'shutdown' } satisfies MainToWorker)
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        p.kill()
        resolve()
      }, 1500)
      p.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
    this.proc = null
  }
}

export function workerEntryPath(): string {
  return join(import.meta.dirname, 'voice-worker.js')
}
