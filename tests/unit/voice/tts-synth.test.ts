import { describe, expect, it, vi } from 'vitest'
import { synthesizeTtsJob, type TtsSynthesizer } from '../../../src/voice-worker/index'

describe('synthesizeTtsJob (VO-02: one failed chunk must not stall/kill the TTS queue)', () => {
  it('resolves to tts-audio on success', async () => {
    const tts: TtsSynthesizer = { synthesize: async () => ({ samples: new Float32Array([0.1, 0.2, 0.3]), sampleRate: 22050 }) }
    const onError = vi.fn()
    const msg = await synthesizeTtsJob({ generation: 1, seq: 0, text: 'hello' }, tts, 1.0, onError)
    expect(msg.type).toBe('tts-audio')
    expect(onError).not.toHaveBeenCalled()
    if (msg.type === 'tts-audio') {
      expect(msg.generation).toBe(1)
      expect(msg.seq).toBe(0)
      expect(new Float32Array(msg.pcm)).toEqual(new Float32Array([0.1, 0.2, 0.3]))
    }
  })

  it('never throws: a synth failure resolves to tts-error and reports the error, instead of rejecting', async () => {
    const tts: TtsSynthesizer = {
      synthesize: async () => {
        throw new Error('sherpa boom')
      },
    }
    const onError = vi.fn()
    await expect(synthesizeTtsJob({ generation: 1, seq: 3, text: 'bad chunk' }, tts, 1.0, onError)).resolves.toEqual({
      type: 'tts-error',
      generation: 1,
      seq: 3,
      error: 'sherpa boom',
    })
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('resolves to tts-error (not a throw) when no TTS engine is loaded at all', async () => {
    const onError = vi.fn()
    const msg = await synthesizeTtsJob({ generation: 2, seq: 0, text: 'x' }, null, 1.0, onError)
    expect(msg).toEqual({ type: 'tts-error', generation: 2, seq: 0, error: 'TTS model not loaded' })
  })

  it('processes a queue where one chunk fails and the rest still succeed, in order', async () => {
    const calls: string[] = []
    const tts: TtsSynthesizer = {
      synthesize: async (text) => {
        calls.push(text)
        if (text === 'boom') throw new Error('nope')
        return { samples: new Float32Array([1]), sampleRate: 16000 }
      },
    }
    const jobs = [
      { generation: 1, seq: 0, text: 'first' },
      { generation: 1, seq: 1, text: 'boom' },
      { generation: 1, seq: 2, text: 'third' },
    ]
    const results = []
    for (const job of jobs) results.push(await synthesizeTtsJob(job, tts, 1.0, () => undefined))
    expect(calls).toEqual(['first', 'boom', 'third'])
    expect(results.map((r) => r.type)).toEqual(['tts-audio', 'tts-error', 'tts-audio'])
    // Every seq gets *some* message — nothing is silently dropped, so a consumer waiting on an
    // ordered sequence (seq 0, 1, 2, ...) always has something to advance past.
    expect(results.map((r) => (r as { seq: number }).seq)).toEqual([0, 1, 2])
  })
})
