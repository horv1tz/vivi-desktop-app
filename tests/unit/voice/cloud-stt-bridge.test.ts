import { describe, expect, it, vi } from 'vitest'
import { CloudSttBridge } from '../../../src/voice-worker/engines'

const SAMPLE_RATE = 16000

function segment(seconds = 1): Float32Array {
  return new Float32Array(Math.round(SAMPLE_RATE * seconds))
}

describe('CloudSttBridge (VO-12)', () => {
  it('hands a long-enough segment to the injected callback and returns its trimmed result', async () => {
    const requestTranscribe = vi.fn().mockResolvedValue('  hello there  ')
    const bridge = new CloudSttBridge(requestTranscribe)
    const seg = segment(1)
    const text = await bridge.finalize(seg)
    expect(requestTranscribe).toHaveBeenCalledWith(seg)
    expect(text).toBe('hello there')
  })

  it('skips the callback and returns empty for a null or too-short segment', async () => {
    const requestTranscribe = vi.fn().mockResolvedValue('should not be used')
    const bridge = new CloudSttBridge(requestTranscribe)
    expect(await bridge.finalize(null)).toBe('')
    expect(await bridge.finalize(segment(0.1))).toBe('')
    expect(requestTranscribe).not.toHaveBeenCalled()
  })

  it('resolves to empty instead of throwing when the callback rejects', async () => {
    const requestTranscribe = vi.fn().mockRejectedValue(new Error('network down'))
    const bridge = new CloudSttBridge(requestTranscribe)
    await expect(bridge.finalize(segment(1))).resolves.toBe('')
  })

  it('resolves to empty instead of hanging forever when the callback never settles', async () => {
    vi.useFakeTimers()
    try {
      const requestTranscribe = vi.fn(() => new Promise<string>(() => undefined))
      const bridge = new CloudSttBridge(requestTranscribe, 1000)
      const pending = bridge.finalize(segment(1))
      await vi.advanceTimersByTimeAsync(1000)
      await expect(pending).resolves.toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reset() is a no-op (state lives entirely in the injected callback)', () => {
    const bridge = new CloudSttBridge(vi.fn())
    expect(() => bridge.reset()).not.toThrow()
  })
})
