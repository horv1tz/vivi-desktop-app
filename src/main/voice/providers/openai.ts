import OpenAI from 'openai'
import type { Dispatcher } from 'undici'

/** Cloud STT/TTS via OpenAI (opt-in). Audio in/out as WAV/MP3 buffers. */
export class OpenAIVoiceProvider {
  private client: OpenAI

  constructor(apiKey: string, dispatcher?: Dispatcher) {
    this.client = new OpenAI({ apiKey, fetchOptions: dispatcher ? ({ dispatcher } as never) : undefined })
  }

  async transcribe(pcm16k: Float32Array, language: 'ru' | 'en' | 'auto'): Promise<string> {
    const wav = encodeWav(pcm16k, 16000)
    const file = new File([wav], 'speech.wav', { type: 'audio/wav' })
    const res = await this.client.audio.transcriptions.create({ file, model: 'gpt-4o-mini-transcribe', language: language === 'auto' ? undefined : language })
    return res.text
  }

  async synthesize(text: string, voice: string): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
    const res = await this.client.audio.speech.create({ model: 'gpt-4o-mini-tts', voice: voice as 'alloy', input: text, response_format: 'mp3' })
    return { bytes: await res.arrayBuffer(), mimeType: 'audio/mpeg' }
  }
}

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}
