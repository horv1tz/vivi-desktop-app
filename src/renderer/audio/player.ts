/**
 * Ordered TTS playback: chunks arrive as (generation, seq) and may be out of order; playback starts
 * only when the next expected seq is available. `stop(generation)` drops everything for barge-in.
 */
export interface AudioChunk {
  generation: number
  seq: number
  sampleRate: number
  pcm: ArrayBuffer
  mimeType?: string
  last: boolean
}

export class TtsPlayer {
  private ctx: AudioContext | null = null
  private generation = -1
  private expectedSeq = 0
  private lastSeq: number | null = null
  private pending = new Map<number, AudioChunk>()
  private playing = false
  private current: AudioBufferSourceNode | null = null
  private sinkId = ''
  onEnded: ((generation: number) => void) | null = null
  onLevel: ((level: number) => void) | null = null

  async setSink(deviceId: string): Promise<void> {
    this.sinkId = deviceId
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
    if (ctx?.setSinkId) await ctx.setSinkId(deviceId).catch(() => undefined)
  }

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'playback' })
      const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
      if (this.sinkId && ctx.setSinkId) void ctx.setSinkId(this.sinkId).catch(() => undefined)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  push(chunk: AudioChunk): void {
    if (chunk.generation < this.generation) return
    if (chunk.generation > this.generation) {
      this.reset(chunk.generation)
    }
    if (chunk.last) {
      this.lastSeq = chunk.seq
      this.maybeFinish()
      return
    }
    this.pending.set(chunk.seq, chunk)
    void this.drain()
  }

  stop(generation?: number): void {
    if (generation !== undefined && generation < this.generation) return
    try {
      this.current?.stop()
    } catch {
      /* not started */
    }
    this.current = null
    this.pending.clear()
    this.playing = false
    this.lastSeq = null
    this.generation = Math.max(this.generation, generation ?? this.generation) + 1
  }

  private reset(generation: number): void {
    this.stop()
    this.generation = generation
    this.expectedSeq = 0
    this.lastSeq = null
  }

  private maybeFinish(): void {
    if (!this.playing && this.lastSeq !== null && this.expectedSeq >= this.lastSeq) {
      const g = this.generation
      this.lastSeq = null
      this.onEnded?.(g)
    }
  }

  private async drain(): Promise<void> {
    if (this.playing) return
    const next = this.pending.get(this.expectedSeq)
    if (!next) return
    this.pending.delete(this.expectedSeq)
    this.playing = true
    const gen = this.generation
    try {
      const ctx = this.context()
      const buffer = await this.decode(ctx, next)
      if (gen !== this.generation) return
      await new Promise<void>((resolve) => {
        const src = ctx.createBufferSource()
        src.buffer = buffer
        src.connect(ctx.destination)
        src.onended = () => resolve()
        this.current = src
        src.start()
      })
    } catch (err) {
      console.warn('tts playback failed', err)
    } finally {
      if (gen === this.generation) {
        this.playing = false
        this.current = null
        this.expectedSeq++
        this.maybeFinish()
        void this.drain()
      }
    }
  }

  private async decode(ctx: AudioContext, chunk: AudioChunk): Promise<AudioBuffer> {
    if (chunk.mimeType) return ctx.decodeAudioData(chunk.pcm.slice(0))
    const samples = new Float32Array(chunk.pcm)
    const buffer = ctx.createBuffer(1, samples.length, chunk.sampleRate || 22050)
    buffer.copyToChannel(samples, 0)
    return buffer
  }
}
