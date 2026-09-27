import { cpus } from 'node:os'
import { app } from 'electron'
import type {
  AgentUiEvent,
  PermissionDecision,
  PermissionRequest,
  QuestionRequest,
  VoiceState,
} from '@shared/events'
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
import {
  describePermissionPrompt,
  describeQuestionPrompt,
  matchPermissionAnswer,
  matchQuestionOption,
  permissionAllowedSpoken,
  permissionDeniedSpoken,
  permissionRetrySpoken,
  questionAnsweredSpoken,
  questionRetrySpoken,
} from './permission-voice'

const log = logger('voice')

/**
 * VO-02 watchdog defaults: generous ceilings so a normal (if slow) reply never trips them, but the
 * user is never left staring at a silently "stuck" orb forever if the agent or TTS playback hangs.
 */
const DEFAULT_THINKING_TIMEOUT_MS = 90_000
const DEFAULT_SPEAKING_TIMEOUT_MS = 60_000

/**
 * A few ms of silence sent in place of a chunk whose synthesis failed (VO-02). The renderer's
 * playback queue is strictly ordered by seq and waits for every one of them before it will fire
 * "done" — without this filler, a single failed chunk leaves a permanent gap and the whole reply
 * (and the 'speaking' state) hangs forever instead of just skipping the bad sentence.
 */
const FILLER_SAMPLE_RATE = 16000
const FILLER_SAMPLES = 160 // 10ms of silence — inaudible, just enough to keep the queue moving

export interface VoiceOrchestratorTimeouts {
  /** Max time to wait for the agent's reply before forcing 'armed' + an 'error' state. */
  thinkingMs?: number
  /** Max time to wait for a TTS turn to finish playing before forcing 'armed' + an 'error' state. */
  speakingMs?: number
}

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
  /** VO-05: speak permission/question prompts and answer them by voice. */
  onPermissionRequest: (listener: (req: PermissionRequest) => void) => () => void
  onPermissionResolved: (listener: (requestId: string) => void) => () => void
  respondPermission: (requestId: string, decision: PermissionDecision) => void
  onQuestionRequest: (listener: (req: QuestionRequest) => void) => () => void
  onQuestionResolved: (listener: (requestId: string) => void) => () => void
  answerQuestion: (requestId: string, answers: Record<string, string>) => void
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
  /** VO-03: set when the reply currently finishing TTS playback came from a voice-originated turn, so playbackEnded knows whether to open a follow-up listening window. */
  private lastReplyWasVoice = false
  private unsubscribeAgent: (() => void) | null = null
  private unsubscribePermission: (() => void) | null = null
  private unsubscribePermissionResolved: (() => void) | null = null
  private unsubscribeQuestion: (() => void) | null = null
  private unsubscribeQuestionResolved: (() => void) | null = null
  /** VO-05: set while a permission/question prompt raised during a voice turn awaits a spoken answer. */
  private pendingPermission: PermissionRequest | null = null
  private pendingQuestion: QuestionRequest | null = null
  private cloud: OpenAIVoiceProvider | null = null
  private starting: Promise<void> | null = null
  private readonly thinkingTimeoutMs: number
  private readonly speakingTimeoutMs: number
  private thinkingWatchdog: ReturnType<typeof setTimeout> | null = null
  private speakingWatchdog: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly deps: OrchestratorDeps,
    timeouts?: VoiceOrchestratorTimeouts,
  ) {
    this.models = new ModelManager(deps.modelsDir, (p) => emit('voice:modelProgress', p))
    this.thinkingTimeoutMs = timeouts?.thinkingMs ?? DEFAULT_THINKING_TIMEOUT_MS
    this.speakingTimeoutMs = timeouts?.speakingMs ?? DEFAULT_SPEAKING_TIMEOUT_MS
  }

  /** Subscribe to agent events; called once the agent controller exists (they reference each other). */
  attachAgent(): void {
    this.unsubscribeAgent?.()
    this.unsubscribeAgent = this.deps.onAgentEvent((e) => this.onAgentEvent(e))
    this.unsubscribePermission?.()
    this.unsubscribePermission = this.deps.onPermissionRequest((req) =>
      this.onPermissionRequest(req),
    )
    this.unsubscribePermissionResolved?.()
    this.unsubscribePermissionResolved = this.deps.onPermissionResolved((id) => {
      if (this.pendingPermission?.requestId === id) {
        this.pendingPermission = null
        this.pushToTalk(false)
      }
    })
    this.unsubscribeQuestion?.()
    this.unsubscribeQuestion = this.deps.onQuestionRequest((req) => this.onQuestionRequest(req))
    this.unsubscribeQuestionResolved?.()
    this.unsubscribeQuestionResolved = this.deps.onQuestionResolved((id) => {
      if (this.pendingQuestion?.requestId === id) {
        this.pendingQuestion = null
        this.pushToTalk(false)
      }
    })
  }

  /**
   * VO-05: only jump in with speech/forced-listening when the interaction that raised this prompt
   * was itself voice-driven — a permission dialog triggered by a typed command shouldn't suddenly
   * start talking and turn on the microphone.
   */
  private onPermissionRequest(req: PermissionRequest): void {
    if (!this.currentVoiceTurn || !this.deps.getSettings().voice.speakReplies) return
    this.pendingPermission = req
    void this.speak(describePermissionPrompt(req, this.deps.getSettings().appearance.language))
    this.pushToTalk(true)
  }

  private onQuestionRequest(req: QuestionRequest): void {
    if (!this.currentVoiceTurn || !this.deps.getSettings().voice.speakReplies) return
    const spoken = describeQuestionPrompt(req, this.deps.getSettings().appearance.language)
    if (!spoken) return // multi-question/multi-select: on-screen dialog only
    this.pendingQuestion = req
    void this.speak(spoken)
    this.pushToTalk(true)
  }

  /** Voice answer to a pending permission/question prompt, if one is pending. Returns true if the transcript was consumed this way. */
  /** Only called when pendingPermission or pendingQuestion is already known to be set. */
  private async answerPending(t: string): Promise<void> {
    const locale = this.deps.getSettings().appearance.language
    if (this.pendingPermission) {
      const decision = matchPermissionAnswer(t)
      if (!decision) {
        await this.speak(permissionRetrySpoken(locale))
        return
      }
      const req = this.pendingPermission
      this.pendingPermission = null
      this.pushToTalk(false)
      this.deps.respondPermission(req.requestId, decision)
      await this.speak(
        decision === 'deny' ? permissionDeniedSpoken(locale) : permissionAllowedSpoken(locale),
      )
      return
    }
    const pending = this.pendingQuestion!
    const q = pending.questions[0]!
    const label = matchQuestionOption(t, q.options)
    if (!label) {
      await this.speak(questionRetrySpoken(locale))
      return
    }
    this.pendingQuestion = null
    this.pushToTalk(false)
    this.deps.answerQuestion(pending.requestId, { [q.question]: label })
    await this.speak(questionAnsweredSpoken(label, locale))
  }

  getState(): VoiceState {
    return this.state
  }

  private setState(state: VoiceState, detail?: string): void {
    this.state = state
    // VO-02: (re)arm or clear the stuck-state watchdogs on every transition, so a legitimate
    // change of state (progress, or moving on to something else) always resets the clock.
    if (state === 'thinking') this.armThinkingWatchdog()
    else this.clearThinkingWatchdog()
    if (state === 'speaking') this.armSpeakingWatchdog()
    else this.clearSpeakingWatchdog()
    emit('voice:state', { state, detail })
  }

  private clearThinkingWatchdog(): void {
    if (this.thinkingWatchdog) {
      clearTimeout(this.thinkingWatchdog)
      this.thinkingWatchdog = null
    }
  }

  private clearSpeakingWatchdog(): void {
    if (this.speakingWatchdog) {
      clearTimeout(this.speakingWatchdog)
      this.speakingWatchdog = null
    }
  }

  private armThinkingWatchdog(): void {
    this.clearThinkingWatchdog()
    this.thinkingWatchdog = setTimeout(() => {
      this.thinkingWatchdog = null
      if (this.state !== 'thinking') return
      log.warn(`voice: 'thinking' watchdog fired after ${this.thinkingTimeoutMs}ms, forcing re-arm`)
      this.currentVoiceTurn = false
      this.setState('error', 'response timed out')
      this.setState(this.workerReady ? 'armed' : 'off')
    }, this.thinkingTimeoutMs)
  }

  private armSpeakingWatchdog(): void {
    this.clearSpeakingWatchdog()
    this.speakingWatchdog = setTimeout(() => {
      this.speakingWatchdog = null
      if (this.state !== 'speaking') return
      log.warn(`voice: 'speaking' watchdog fired after ${this.speakingTimeoutMs}ms, forcing re-arm`)
      const gen = this.speakGeneration
      this.worker?.send({ type: 'tts-cancel', generation: gen })
      emit('voice:stopPlayback', { generation: gen })
      this.speakGeneration++
      this.pendingSeq = 0
      this.speaking = false
      this.worker?.send({ type: 'set-speaking', speaking: false })
      this.setState('error', 'playback timed out')
      this.setState(this.workerReady ? 'armed' : 'off')
    }, this.speakingTimeoutMs)
  }

  /** A short, silent stand-in for a chunk whose TTS synthesis failed (VO-02): keeps the
   *  renderer's strictly-ordered playback queue moving instead of stalling on the missing seq. */
  private emitSilentFiller(generation: number, seq: number): void {
    emit('voice:audio', {
      generation,
      seq,
      sampleRate: FILLER_SAMPLE_RATE,
      pcm: new Float32Array(FILLER_SAMPLES).buffer,
      last: false,
    })
  }

  /** Models that still need downloading for the current settings. */
  missingModels(): string[] {
    const v = this.deps.getSettings().voice
    return requiredModels({
      sttModel: v.sttModel,
      ttsVoice: v.ttsVoice,
      wakeWordEnabled: v.wakeWordEnabled,
      wakeWordStrategy: v.wakeWordStrategy,
    }).filter((id) => !this.models.isInstalled(id))
  }

  private buildModelConfig(): WorkerModelConfig {
    const v = this.deps.getSettings().voice
    const stt = modelById(v.sttModel)
    const sttPaths = this.models.paths(v.sttModel)
    const ttsPaths = this.models.paths(v.ttsVoice)
    const vad = this.models.paths('vad-silero-v5')
    const kws =
      v.wakeWordEnabled && v.wakeWordStrategy === 'kws'
        ? this.models.paths('kws-zipformer-en')
        : null
    return {
      stt:
        stt?.engine && sttPaths
          ? { engine: stt.engine, paths: sttPaths, language: v.language }
          : undefined,
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
        const key =
          process.platform === 'darwin'
            ? 'DYLD_LIBRARY_PATH'
            : process.platform === 'win32'
              ? 'PATH'
              : 'LD_LIBRARY_PATH'
        env[key] =
          `${libDir}${env[key] ? `${process.platform === 'win32' ? ';' : ':'}${env[key]}` : ''}`
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
        // Both the transcript strategy (fuzzy-matches the literal decoded text, so needs the
        // Cyrillic spelling to catch a Russian STT model's output) and the KWS strategy
        // (phoneticizes each keyword via keywordVariants) need these regardless of UI/STT
        // language — VO-01: the Russian default transcript strategy previously never matched
        // because only the Latin spelling was ever sent to the worker.
        keywords: ['vivi', 'hey vivi', 'виви', 'эй виви', 'вивиан'],
        numThreads: Math.max(1, Math.min(4, Math.floor((cpus().length || 2) / 2))),
        followupMs: settings.voice.followupMs,
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

  /** Re-send the microphone port after the main window (re)loads. */
  redeliverAudioPort(): void {
    if (this.workerReady && this.worker)
      this.deps.deliverAudioPort(this.worker.createAudioChannel())
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
        else if (msg.state === 'armed' && !this.speaking && this.state !== 'thinking')
          this.setState('armed')
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
        emit('voice:audio', {
          generation: msg.generation,
          seq: msg.seq,
          sampleRate: msg.sampleRate,
          pcm: msg.pcm,
          last: false,
        })
        break
      case 'tts-error':
        log.warn(`tts error seq ${msg.seq}: ${msg.error}`)
        // VO-02: the renderer's playback queue is strictly ordered by seq, so a chunk that failed
        // to synthesize must still be "filled in" or every chunk after it (and the final 'done'
        // marker) would wait forever for a seq that will never arrive.
        if (msg.generation === this.speakGeneration) this.emitSilentFiller(msg.generation, msg.seq)
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
    // Synchronous check (no `await` before it) so the common case — nothing pending — falls
    // through to the normal turn-start below within the same microtask, exactly as before VO-05.
    if (this.pendingPermission || this.pendingQuestion) {
      await this.answerPending(t)
      return
    }
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
      if (!this.speaking) {
        this.setState('armed')
        // VO-03: nothing was queued to speak, so playbackEnded() will never fire for this turn —
        // open the follow-up window right away instead of waiting for an event that never comes.
        this.maybeStartFollowup()
      } else {
        this.lastReplyWasVoice = true
      }
      if (this.pendingSeq > 0)
        emit('voice:audio', {
          generation: this.speakGeneration,
          seq: this.pendingSeq,
          sampleRate: 0,
          pcm: new ArrayBuffer(0),
          last: true,
        })
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
      const { bytes, mimeType } = await this.cloud.synthesize(
        text,
        this.deps.getSettings().voice.openaiVoice,
      )
      if (generation !== this.speakGeneration) return
      emit('voice:audio', {
        generation,
        seq,
        sampleRate: 0,
        pcm: bytes,
        last: false,
        mimeType,
      } as never)
    } catch (err) {
      log.warn('cloud tts failed', err)
      // Same reasoning as the local-worker 'tts-error' case above: fill the gap so the ordered
      // playback queue (and therefore the 'speaking' state) doesn't hang on this seq forever.
      if (generation === this.speakGeneration) this.emitSilentFiller(generation, seq)
    }
  }

  /** Renderer reports that playback of a generation finished. */
  playbackEnded(generation: number): void {
    if (generation !== this.speakGeneration) return
    this.speaking = false
    this.worker?.send({ type: 'set-speaking', speaking: false })
    if (this.state === 'speaking') this.setState(this.workerReady ? 'armed' : 'off')
    if (this.lastReplyWasVoice) {
      this.lastReplyWasVoice = false
      this.maybeStartFollowup()
    }
  }

  /** VO-03: opens the wake-word-free follow-up window, unless a permission/question prompt is already forcing listening via push-to-talk. */
  private maybeStartFollowup(): void {
    if (this.pendingPermission || this.pendingQuestion) return
    this.worker?.send({ type: 'followup' })
  }

  async speak(text: string): Promise<void> {
    if (!this.workerReady) await this.start()
    this.speakGeneration++
    this.pendingSeq = 0
    this.chunker.reset()
    for (const chunk of [...this.chunker.push(text), ...this.chunker.flush()])
      this.speakChunk(chunk.text)
    if (this.pendingSeq > 0)
      emit('voice:audio', {
        generation: this.speakGeneration,
        seq: this.pendingSeq,
        sampleRate: 0,
        pcm: new ArrayBuffer(0),
        last: true,
      })
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
    this.clearThinkingWatchdog()
    this.clearSpeakingWatchdog()
    this.unsubscribeAgent?.()
    this.unsubscribePermission?.()
    this.unsubscribePermissionResolved?.()
    this.unsubscribeQuestion?.()
    this.unsubscribeQuestionResolved?.()
    await this.worker?.stop()
    this.worker = null
  }
}

export function appVersionTag(): string {
  return app.getVersion()
}
