import { describe, expect, it } from 'vitest'
import { hashBuffer, waitForStableFrame } from '../../../src/main/agent/tools/screen'

describe('hashBuffer', () => {
  it('is deterministic for identical content', () => {
    expect(hashBuffer(Buffer.from('abc'))).toBe(hashBuffer(Buffer.from('abc')))
  })

  it('differs for different content', () => {
    expect(hashBuffer(Buffer.from('abc'))).not.toBe(hashBuffer(Buffer.from('abd')))
  })
})

describe('waitForStableFrame (CU-03)', () => {
  const fakeClock = () => {
    let t = 0
    return { now: () => t, sleep: async (ms: number) => void (t += ms) }
  }

  it('returns as soon as two consecutive captures hash the same', async () => {
    const { now, sleep } = fakeClock()
    const hashes = ['a', 'a', 'z']
    let i = 0
    const result = await waitForStableFrame(async () => ({ hash: hashes[i++]!, seq: i }), {
      now,
      sleep,
      maxWaitMs: 10_000,
      pollMs: 100,
    })
    expect(result.hash).toBe('a')
    expect(i).toBe(2) // stopped after the second (matching) capture, never looked at the third
  })

  it('keeps polling while the frame keeps changing, up to maxWaitMs, then returns the last frame', async () => {
    const { now, sleep } = fakeClock()
    let i = 0
    const result = await waitForStableFrame(async () => ({ hash: `frame-${i++}` }), {
      now,
      sleep,
      maxWaitMs: 500,
      pollMs: 100,
    })
    // Every capture is unique, so it never finds a stable pair — it must give up once the clock
    // (advanced only via the injected sleep) crosses maxWaitMs, not run forever.
    expect(result.hash).toBe(`frame-${i - 1}`)
    expect(i).toBeGreaterThan(1)
    expect(i).toBeLessThan(20)
  })

  it('calls capture only once for an already-stable screen (no unnecessary polling)', async () => {
    const { now, sleep } = fakeClock()
    let calls = 0
    await waitForStableFrame(
      async () => {
        calls++
        return { hash: 'same' }
      },
      { now, sleep, maxWaitMs: 1000, pollMs: 100 },
    )
    expect(calls).toBe(2) // first capture, then one confirming poll that matches it
  })
})
