/**
 * Pure voice pipeline state machine (no native code): armed → listening → finalizing → armed.
 * Engines are injected so the logic is unit-testable with synthetic audio.
 */
export type PipelineState = 'off' | 'armed' | 'listening' | 'finalizing' | 'followup'

export interface WakeEngine {
  /** Feed a frame; returns true when the wake word fired. */
  feed(frame: Float32Array): boolean
  reset(): void
}

export interface VadEngine {
  /** Feed a frame; returns whether speech is currently detected. */
  feed(frame: Float32Array): boolean
  /** Completed speech segments (after trailing silence). */
  popSegments(): Float32Array[]
  flush(): void
  reset(): void
}

export interface SttEngine {
  readonly streaming: boolean
  /** Streaming engines return partial text as frames arrive. */
  feed?(frame: Float32Array): string | null
  /** Final decode: streaming engines finalize their stream, offline engines decode the segment. */
  finalize(segment: Float32Array | null): Promise<string>
  reset(): void
}

export interface PipelineEvents {
  onState: (state: PipelineState) => void
  onWake: () => void
  onPartial: (text: string) => void
  onFinal: (text: string, durationMs: number) => void
  onTimeout: () => void
  onLevel: (rms: number) => void
  onBargeIn: () => void
  onError: (message: string) => void
}

export interface PipelineOptions {
  sampleRate: number
  /** Silence after speech that ends an utterance (VAD handles most of it; this is the safety net). */
  silenceMs: number
  /** No speech after wake/PTT within this window → timeout. */
  noSpeechTimeoutMs: number
  maxUtteranceMs: number
  preRollMs: number
  wakeWordEnabled: boolean
  /** Barge-in: speech must persist this long while TTS is playing. */
  bargeInMs: number
  bargeInGraceMs: number
  /** VO-04: only the wake word interrupts TTS playback, instead of any sustained speech. */
  bargeInRequiresWakeWord: boolean
  /** VO-03: after a voice-turn reply finishes speaking, how long to listen without requiring the wake word again. 0 disables it. */
  followupMs: number
  now?: () => number
}

export class VoicePipeline {
  private state: PipelineState = 'off'
  private preRoll: Float32Array[] = []
  private preRollSamples = 0
  private captured: Float32Array[] = []
  private capturedSamples = 0
  private listeningSince = 0
  private speechSeen = false
  private lastSpeechAt = 0
  private speaking = false
  private speakingSince = 0
  private bargeSpeechStart = 0
  private levelAt = 0
  private finalizing = false
  private followupSince = 0
  private readonly now: () => number

  constructor(
    private readonly engines: { wake: WakeEngine | null; vad: VadEngine; stt: SttEngine },
    private readonly opts: PipelineOptions,
    private readonly events: PipelineEvents,
  ) {
    this.now = opts.now ?? (() => Date.now())
  }

  get current(): PipelineState {
    return this.state
  }

  private setState(s: PipelineState): void {
    if (this.state === s) return
    this.state = s
    this.events.onState(s)
  }

  arm(): void {
    if (this.state === 'listening' || this.state === 'finalizing') return
    this.engines.wake?.reset()
    this.setState('armed')
  }

  /** VO-03: called once a voice-turn reply finishes speaking — listens for a follow-up without the wake word for a bounded window. */
  startFollowup(): void {
    if (this.opts.followupMs <= 0) return
    if (this.state === 'listening' || this.state === 'finalizing') return
    this.followupSince = this.now()
    this.setState('followup')
  }

  disarm(): void {
    this.captured = []
    this.capturedSamples = 0
    this.setState('off')
  }

  setSpeaking(speaking: boolean): void {
    this.speaking = speaking
    this.speakingSince = speaking ? this.now() : 0
    this.bargeSpeechStart = 0
  }

  /** Push-to-talk or wake: start capturing an utterance now. */
  startListening(opts: { withPreRoll: boolean }): void {
    if (this.state === 'listening') return
    this.engines.vad.reset()
    this.engines.stt.reset()
    this.captured = []
    this.capturedSamples = 0
    if (opts.withPreRoll) {
      for (const f of this.preRoll) this.pushCaptured(f)
    }
    this.listeningSince = this.now()
    this.speechSeen = false
    this.lastSpeechAt = 0
    this.setState('listening')
  }

  /** PTT released: finalize what was captured so far. */
  stopListening(): void {
    if (this.state !== 'listening') return
    void this.finalize(true)
  }

  cancel(): void {
    if (this.state === 'listening' || this.state === 'finalizing') {
      this.captured = []
      this.capturedSamples = 0
      this.engines.vad.reset()
      this.engines.stt.reset()
      this.finalizing = false
      this.setState(this.opts.wakeWordEnabled || this.engines.wake ? 'armed' : 'off')
    }
  }

  private pushCaptured(frame: Float32Array): void {
    this.captured.push(frame)
    this.capturedSamples += frame.length
  }

  private pushPreRoll(frame: Float32Array): void {
    this.preRoll.push(frame)
    this.preRollSamples += frame.length
    const max = (this.opts.preRollMs / 1000) * this.opts.sampleRate
    while (this.preRollSamples > max && this.preRoll.length > 1) {
      const dropped = this.preRoll.shift()!
      this.preRollSamples -= dropped.length
    }
  }

  private emitLevel(frame: Float32Array): void {
    const t = this.now()
    if (t - this.levelAt < 66) return
    this.levelAt = t
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!
    this.events.onLevel(Math.sqrt(sum / Math.max(1, frame.length)))
  }

  /** Feed one PCM frame (Float32 in [-1, 1] at opts.sampleRate). */
  feed(frame: Float32Array): void {
    if (this.state === 'off') return
    this.emitLevel(frame)
    if (this.state === 'armed') {
      this.pushPreRoll(frame)
      if (this.speaking) {
        this.detectBargeIn(frame)
        return
      }
      if (this.opts.wakeWordEnabled && this.engines.wake && this.engines.wake.feed(frame)) {
        this.events.onWake()
        this.startListening({ withPreRoll: false })
      }
      return
    }
    if (this.state === 'followup') {
      if (this.now() - this.followupSince > this.opts.followupMs) {
        this.arm()
        // Re-dispatch this frame as 'armed' instead of dropping it, in case it's the very frame
        // the wake word or speech starts on.
        this.feed(frame)
        return
      }
      this.pushPreRoll(frame)
      if (this.engines.vad.feed(frame)) this.startListening({ withPreRoll: true })
      return
    }
    if (this.state === 'listening') {
      const t = this.now()
      this.pushCaptured(frame)
      const speech = this.engines.vad.feed(frame)
      if (speech) {
        this.speechSeen = true
        this.lastSpeechAt = t
      }
      if (this.engines.stt.streaming && this.engines.stt.feed) {
        const partial = this.engines.stt.feed(frame)
        if (partial) this.events.onPartial(partial)
      }
      const segments = this.engines.vad.popSegments()
      if (segments.length > 0) {
        void this.finalize(false, segments[segments.length - 1] ?? null)
        return
      }
      if (!this.speechSeen && t - this.listeningSince > this.opts.noSpeechTimeoutMs) {
        this.cancel()
        this.events.onTimeout()
        return
      }
      if (this.speechSeen && t - this.lastSpeechAt > this.opts.silenceMs + 600) {
        void this.finalize(true)
        return
      }
      if (t - this.listeningSince > this.opts.maxUtteranceMs) void this.finalize(true)
    }
  }

  private detectBargeIn(frame: Float32Array): void {
    const t = this.now()
    if (t - this.speakingSince < this.opts.bargeInGraceMs) return
    // VO-04: "interrupt only by wake word" — while Vivi is speaking, ordinary sustained speech
    // (someone talking nearby, a TV, a phone call) never counts as an interrupt; only saying the
    // wake word again does. Falls back to ordinary VAD-gated barge-in if the wake engine isn't
    // available (wake word itself disabled, or PTT-only setup) — the setting can't silently
    // disable barge-in entirely.
    if (this.opts.bargeInRequiresWakeWord && this.engines.wake) {
      if (!this.engines.wake.feed(frame)) return
      this.speaking = false
      this.engines.wake.reset()
      this.events.onBargeIn()
      this.startListening({ withPreRoll: false })
      return
    }
    const speech = this.engines.vad.feed(frame)
    if (!speech) {
      this.bargeSpeechStart = 0
      return
    }
    if (!this.bargeSpeechStart) this.bargeSpeechStart = t
    if (t - this.bargeSpeechStart >= this.opts.bargeInMs) {
      this.bargeSpeechStart = 0
      this.speaking = false
      this.engines.vad.reset()
      this.events.onBargeIn()
      this.startListening({ withPreRoll: true })
    }
  }

  private concatCaptured(): Float32Array {
    const out = new Float32Array(this.capturedSamples)
    let off = 0
    for (const f of this.captured) {
      out.set(f, off)
      off += f.length
    }
    return out
  }

  private async finalize(useCaptured: boolean, segment: Float32Array | null = null): Promise<void> {
    if (this.finalizing) return
    this.finalizing = true
    this.setState('finalizing')
    const started = this.listeningSince
    const audio = segment ?? (useCaptured ? this.concatCaptured() : null)
    this.captured = []
    this.capturedSamples = 0
    try {
      this.engines.vad.flush()
      const text = (await this.engines.stt.finalize(audio)).trim()
      const durationMs = this.now() - started
      if (text) this.events.onFinal(text, durationMs)
      else this.events.onTimeout()
    } catch (err) {
      this.events.onError((err as Error).message)
    } finally {
      this.engines.vad.reset()
      this.engines.stt.reset()
      this.finalizing = false
      if (this.state === 'finalizing')
        this.setState(this.opts.wakeWordEnabled || this.engines.wake ? 'armed' : 'off')
    }
  }
}
