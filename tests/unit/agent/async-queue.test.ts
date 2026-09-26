import { describe, expect, it } from 'vitest'
import { AsyncQueue } from '../../../src/main/agent/async-queue'

describe('AsyncQueue', () => {
  it('delivers pushed items in order and completes on end()', async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    const seen: number[] = []
    const consumer = (async () => {
      for await (const v of q) seen.push(v)
    })()
    await new Promise((r) => setTimeout(r, 5))
    q.push(3)
    q.end()
    await consumer
    expect(seen).toEqual([1, 2, 3])
  })

  it('resolves a waiting consumer when an item arrives later', async () => {
    const q = new AsyncQueue<string>()
    const it = q[Symbol.asyncIterator]()
    const pending = it.next()
    q.push('late')
    await expect(pending).resolves.toEqual({ value: 'late', done: false })
  })

  it('rejects pushes after end()', () => {
    const q = new AsyncQueue<number>()
    q.end()
    expect(q.push(1)).toBe(false)
    expect(q.isEnded).toBe(true)
  })
})
