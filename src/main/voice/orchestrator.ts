import { cpus } from 'node:os'
import { app } from 'electron'
import type { AgentUiEvent, VoiceState } from '@shared/events'
import type { SendArgs } from '@shared/ipc'
import type { Settings } from '@shared/settings'
import type { Dispatcher } from 'undici'
import { modelById, requiredModels } from '@shared/models'
import type { WorkerModelConfig, WorkerToMain } from '../../voice-worker/protocol'
import { ModelManager } from './models'
import { SentenceChunker } from './sentence-chunker'
import { VoiceWorkerClient, workerEntryPath } from './worker-client'
import { OpenAIVoiceProvider } from './providers/openai'
import { secrets } from '../auth/secrets'
import { emit } from '../ipc/emitters'
import { handle } from '../ipc/handlers'
import { logger } from '../logging/log'
import { showOverlay } from '../app/windows'
import { sherpaLibDir } from './native-paths'

const log = logger('voice')

export interface OrchestratorDeps {
  getSettings: () => Settings
  modelsDir: string
  /** Send a transcript to the agent as a voice message. */
  sendToAgent: (args: SendArgs) => Promise<unknown>
  interruptAgent: () => Promise<void>
  onAgentEvent: (listener: (e: AgentUiEvent) => void) => () => void
  getDispatcher: () => Dispatcher | undefined
  /** Hand the renderer-side audio port to the main window. */
  deliverAudioPort: (port: Electron.MessagePortMain) => void
  isOverlayVisible: () => boolean
}

/**
 * Coordinates microphone → worker → agent → TTS → renderer playback, including barge-in.
 */
export class VoiceOrchestrator {
  readonly models: ModelManager
  private worker: VoiceWorkerClient | null = null
  private state: VoiceState = 'off'
  private workerReady = false
  private chunker = new SentenceChunker()
  private speakGeneration = 0
  private pendingSeq = 0
  private speaking = false
  private currentVoiceTurn = false
  private unsubscribeAgent: (() => void) | null = null
  private cloud: OpenAIVoiceProvider | null = null
  private starting: Promise<void> | null = null

  constructor(private readonly deps: OrchestratorDeps) {
    this.models = new ModelManager(deps.modelsDir, (p) => emit('voice:modelProgress', p))
  }

  /** Subscribe to agent events; called once the agent controller exists (they reference each other). */
  attachAgent(): void {
    this.unsubscribeAgent?.()
    this.unsubscribeAgent = this.deps.onAgentEvent((e) => this.onAgentEvent(e))
  }

  getState(): VoiceState {
    return this.state
  }

  private setState(state: VoiceState, detail?: string): void {
    this.state = state
    emit('voice:state', { state, detail })
  }

  /** Models that still need downloading for the current settings. */
  missingModels(): string[] {
    const v = this.deps.getSettings().voice
    return requiredModels({ sttModel: v.sttModel, ttsVoice: v.ttsVoice, wakeWordEnabled: v.wakeWordEnabled, wakeWordStrategy: v.wakeWordStrategy }).filter((id) => !this.models.isInstalled(id))
  }

  private buildModelConfig(): WorkerModelConfig {
    const v = this.deps.getSettings().voice
    const stt = modelById(v.sttModel)
    const sttPaths = this.models.paths(v.sttModel)
    const ttsPaths = this.models.paths(v.ttsVoice)
    const vad = this.models.paths('vad-silero-v5')
    const kws = v.wakeWordEnabled && v.wakeWordStrategy === 'kws' ? this.models.paths('kws-zipformer-en') : null
    return {
      stt: stt?.engine && sttPaths ? { engine: stt.engine, paths: sttPaths, language: v.language } : undefined,
      vad: vad ?? undefined,
      kws: kws ?? undefined,
      tts: ttsPaths ? { paths: ttsPaths, speed: 1.0 } : undefined,
    }
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting
    this.starting = this.doStart().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async doStart(): Promise<void> {
    const settings = this.deps.getSettings()
    if (!settings.voice.enabled) {
      this.setState('off')
      return
    }
    const missing = this.missingModels()
    if (missing.length) {
      this.setState('error', `missing models: ${missing.join(', ')}`)
      return
    }
    if (!this.worker) {
      const env: Record<string, string | undefined> = { ...process.env }
      const libDir = sherpaLibDir()
      if (libDir) {
        const key = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : process.platform === 'win32' ? 'PATH' : 'LD_LIBRARY_PATH'
        env[key] = `${libDir}${env[key] ? `${process.platform === 'win32' ? ';' : ':'}${env[key]}` : ''}`
      }
      const worker = new VoiceWorkerClient({ entry: workerEntryPath(), env })
      worker.on('message', (msg: WorkerToMain) => this.onWorkerMessage(msg))
      worker.on('exit', () => {
        this.workerReady = false
        this.setState('error', 'voice worker exited')
      })
      worker.on('restarted', () => void this.initWorker())
      this.worker = worker
      await worker.start()
    }
    await this.initWorker()
  }

  private async initWorker(): Promise<void> {
    const worker = this.worker
    if (!worker) return
    const settings = this.deps.getSettings()
    this.workerReady = false
    this.setState('off', 'loading models')
    const done = new Promise<void>((resolve, reject) => {
      const onMsg = (msg: WorkerToMain): void => {
        if (msg.type !== 'init-done') return
        worker.off('message', onMsg)
        if (msg.ok) resolve()
        else reject(new Error(msg.error ?? 'voice init failed'))
      }
      worker.on('message', onMsg)
    })
    worker.send({
      type: 'init',
      models: this.buildModelConfig(),
      settings: {
        silenceMs: settings.voice.silenceMs,
        wakeWordEnabled: settings.voice.wakeWordEnabled,
        wakeWordStrategy: settings.voice.wakeWordStrategy,
        wakeWordSensitivity: settings.voice.wakeWordSensitivity,
        keywords: ['vivi', 'hey vivi'],
        numThreads: Math.max(1, Math.min(4, Math.floor((cpus().length || 2) / 2))),
      },
      libDir: sherpaLibDir() ?? undefined,
    })
    try {
      await done
      this.workerReady = true
      this.deps.deliverAudioPort(worker.createAudioChannel())
      worker.send({ type: 'arm' })
      this.setState('armed')
      log.info('voice pipeline armed')
    } catch (err) {
      log.error('voice init failed', err)
      this.setState('error', (err as Error).message)
    }
  }

  async stop(): Promise<void> {
    this.worker?.send({ type: 'disarm' })
    this.setState('off')
  }

  async restart(): Promise<void> {
    await this.stopSpeaking()
    if (this.worker) {
      await this.worker.stop()
      this.worker = null
    }
    this.workerReady = false
    await this.start()
  }

  pushToTalk(active: boolean): void {
    if (!this.workerReady) {
      void this.start().then(() => this.worker?.send({ type: 'ptt', active }))
      return
    }
    if (active) void this.stopSpeaking()
    this.worker?.send({ type: 'ptt', active })
  }

  private onWorkerMessage(msg: WorkerToMain): void {
    switch (msg.type) {
      case 'state':
        if (msg.state === 'listening') this.setState('listening')
        else if (msg.state === 'transcribing') this.setState('transcribing')
        else if (msg.state === 'armed' && !this.speaking && this.state !== 'thinking') this.setState('armed')
        else if (msg.state === 'off' && !this.speaking) this.setState('off')
        break
      case 'wake':
        void this.stopSpeaking()
        if (!this.deps.isOverlayVisible()) showOverlay()
        break
      case 'partial':
        emit('voice:transcript', { text: msg.text, final: false })
        break
      case 'final':
        emit('voice:transcript', { text: msg.text, final: true })
        void this.handleTranscript(msg.text)
        break
      case 'timeout':
        emit('voice:transcript', { text: '', final: true })
        if (!this.speaking) this.setState('armed')
        break
      case 'level':
        emit('voice:level', Math.min(1, msg.rms * 6))
        break
      case 'barge-in':
        log.info('barge-in')
        void this.stopSpeaking()
        void this.deps.interruptAgent()
        break
      case 'tts-audio':
        emit('voice:audio', { generation: msg.generation, seq: msg.seq, sampleRate: msg.sampleRate, pcm: msg.pcm, last: false })
        break
      case 'tts-error':
        log.warn(`tts error seq ${msg.seq}: ${msg.error}`)
        break
      case 'error':
        log.error('worker error', msg.message)
        this.setState('error', msg.message)
        break
      default:
        break
    }
  }

  private async handleTranscript(text: string): Promise<void> {
    const t = text.trim()
    if (!t) return
    this.currentVoiceTurn = true
    this.chunker.reset()
    this.speakGeneration++
    this.pendingSeq = 0
    this.setState('thinking')
    try {
      await this.deps.sendToAgent({ text: t, fromVoice: true })
    } catch (err) {
      log.error('sendToAgent failed', err)
      this.setState('armed')
    }
  }

  private onAgentEvent(e: AgentUiEvent): void {
    if (!this.currentVoiceTurn) return
    const v = this.deps.getSettings().voice
    if (!v.speakReplies) {
      if (e.type === 'result') {
        this.currentVoiceTurn = false
        this.setState('armed')
      }
      return
    }
    if (e.type === 'text-delta' && e.kind === 'text' && !e.messageId.startsWith('sub:')) {
      for (const chunk of this.chunker.push(e.text)) this.speakChunk(chunk.text)
    } else if (e.type === 'result' || e.type === 'error') {
      for (const chunk of this.chunker.flush()) this.speakChunk(chunk.text)
      this.currentVoiceTurn = false
      if (!this.speaking) this.setState('armed')
      if (this.pendingSeq > 0) emit('voice:audio', { generation: this.speakGeneration, seq: this.pendingSeq, sampleRate: 0, pcm: new ArrayBuffer(0), last: true })
    }
  }

  private speakChunk(text: string): void {
    if (!text.trim()) return
    if (!this.speaking) {
      this.speaking = true
      this.worker?.send({ type: 'set-speaking', speaking: true })
      this.setState('speaking')
    }
    const seq = this.pendingSeq++
    const v = this.deps.getSettings().voice
    if (v.ttsProvider === 'openai' && this.deps.getSettings().features.cloudVoice) {
      void this.cloudSpeak(text, this.speakGeneration, seq)
      return
    }
    this.worker?.send({ type: 'tts', generation: this.speakGeneration, seq, text })
  }

  private async cloudSpeak(text: string, generation: number, seq: number): Promise<void> {
    try {
      if (!this.cloud) {
        const key = await secrets().get('openaiApiKey')
        if (!key) throw new Error('OpenAI API key is not set')
        this.cloud = new OpenAIVoiceProvider(key, this.deps.getDispatcher())
      }
      const { bytes, mimeType } = await this.cloud.synthesize(text, this.deps.getSettings().voice.openaiVoice)
      if (generation !== this.speakGeneration) return
      emit('voice:audio', { generation, seq, sampleRate: 0, pcm: bytes, last: false, mimeType } as never)
    } catch (err) {
      log.warn('cloud tts failed', err)
    }
  }

  /** Renderer reports that playback of a generation finished. */
  playbackEnded(generation: number): void {
    if (generation !== this.speakGeneration) return
    this.speaking = false
    this.worker?.send({ type: 'set-speaking', speaking: false })
    if (this.state === 'speaking') this.setState(this.workerReady ? 'armed' : 'off')
  }

  async speak(text: string): Promise<void> {
    if (!this.workerReady) await this.start()
    this.speakGeneration++
    this.pendingSeq = 0
    this.chunker.reset()
    for (const chunk of [...this.chunker.push(text), ...this.chunker.flush()]) this.speakChunk(chunk.text)
    if (this.pendingSeq > 0) emit('voice:audio', { generation: this.speakGeneration, seq: this.pendingSeq, sampleRate: 0, pcm: new ArrayBuffer(0), last: true })
  }

  async stopSpeaking(): Promise<void> {
    const gen = this.speakGeneration
    this.worker?.send({ type: 'tts-cancel', generation: gen })
    emit('voice:stopPlayback', { generation: gen })
    this.speakGeneration++
    this.pendingSeq = 0
    if (this.speaking) {
      this.speaking = false
      this.worker?.send({ type: 'set-speaking', speaking: false })
      if (this.state === 'speaking') this.setState(this.workerReady ? 'armed' : 'off')
    }
  }

  registerIpc(): void {
    handle('voice:listModels', () => this.models.list())
    handle('voice:downloadModel', (_e, id) => this.models.download(id))
    handle('voice:deleteModel', (_e, id) => this.models.delete(id))
    handle('voice:start', () => this.start())
    handle('voice:stop', () => this.stop())
    handle('voice:pushToTalk', (_e, active) => this.pushToTalk(active))
    handle('voice:speak', (_e, text) => this.speak(text))
    handle('voice:stopSpeaking', () => this.stopSpeaking())
    handle('voice:getState', () => this.state)
    handle('voice:playbackEnded', (_e, generation) => this.playbackEnded(generation))
    handle('voice:setCloudKey', async (_e, provider, key) => {
      if (provider === 'openai') {
        await secrets().set('openaiApiKey', key)
        this.cloud = null
      }
    })
  }

  async dispose(): Promise<void> {
    this.unsubscribeAgent?.()
    await this.worker?.stop()
    this.worker = null
  }
}

export function appVersionTag(): string {
  return app.getVersion()
}
