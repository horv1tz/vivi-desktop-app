/// <reference lib="dom" />
// AudioWorklet processor: converts the mic's float frames to 16 kHz Int16 PCM frames of 20 ms
// and posts them straight to the voice worker's MessagePort (transferred in from the main thread).

declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean
}
declare function registerProcessor(name: string, ctor: typeof AudioWorkletProcessor): void

const TARGET_RATE = 16000
const FRAME = 320 // 20 ms at 16 kHz

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private target: MessagePort | null = null
  private buffer = new Float32Array(FRAME * 4)
  private filled = 0
  private ratio = sampleRate / TARGET_RATE
  private phase = 0
  private muted = false

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent) => {
      const data = e.data as { port?: MessagePort; muted?: boolean }
      if (data.port) {
        this.target = data.port
        this.target.start?.()
      }
      if (typeof data.muted === 'boolean') this.muted = data.muted
    }
  }

  override process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0]
    if (!input || !this.target || this.muted) return true
    // Linear resampling to 16 kHz (the context is usually created at 16 kHz already, ratio = 1).
    if (this.ratio === 1) {
      this.push(input)
    } else {
      const outLen = Math.floor((input.length - this.phase) / this.ratio)
      const out = new Float32Array(Math.max(0, outLen))
      let pos = this.phase
      for (let i = 0; i < out.length; i++) {
        const idx = Math.floor(pos)
        const frac = pos - idx
        const a = input[idx] ?? 0
        const b = input[idx + 1] ?? a
        out[i] = a + (b - a) * frac
        pos += this.ratio
      }
      this.phase = pos - input.length
      this.push(out)
    }
    return true
  }

  private push(samples: Float32Array): void {
    let offset = 0
    while (offset < samples.length) {
      const n = Math.min(FRAME - this.filled, samples.length - offset)
      this.buffer.set(samples.subarray(offset, offset + n), this.filled)
      this.filled += n
      offset += n
      if (this.filled === FRAME) {
        const pcm = new Int16Array(FRAME)
        for (let i = 0; i < FRAME; i++) {
          const s = Math.max(-1, Math.min(1, this.buffer[i]!))
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        this.target!.postMessage(pcm.buffer, [pcm.buffer])
        this.filled = 0
      }
    }
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)
