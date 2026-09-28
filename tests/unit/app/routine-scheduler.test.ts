import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoutineEntry, RoutineRunResult } from '../../../src/shared/events'
import { RoutineScheduler } from '../../../src/main/app/routine-scheduler'

function makeRoutine(over: Partial<RoutineEntry> = {}): RoutineEntry {
  return {
    id: 'r1',
    name: 'Digest',
    prompt: 'summarize',
    schedule: { kind: 'interval', minutes: 60 },
    safeMode: true,
    enabled: true,
    nextRunAt: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

const okResult: RoutineRunResult = { timestamp: 0, summary: 'ok', isError: false }

afterEach(() => {
  vi.useRealTimers()
})

describe('RoutineScheduler.tick', () => {
  it('runs an enabled routine whose nextRunAt has passed', async () => {
    const routine = makeRoutine({ nextRunAt: 100 })
    const runRoutine = vi.fn().mockResolvedValue(okResult)
    const onRun = vi.fn()
    const scheduler = new RoutineScheduler({
      getRoutines: () => [routine],
      runRoutine,
      onRun,
      now: () => 200,
    })
    await scheduler.tick()
    expect(runRoutine).toHaveBeenCalledWith(routine)
    expect(onRun).toHaveBeenCalledWith(routine, okResult)
  })

  it('skips a routine whose nextRunAt is still in the future', async () => {
    const routine = makeRoutine({ nextRunAt: 500 })
    const runRoutine = vi.fn().mockResolvedValue(okResult)
    const scheduler = new RoutineScheduler({
      getRoutines: () => [routine],
      runRoutine,
      onRun: vi.fn(),
      now: () => 200,
    })
    await scheduler.tick()
    expect(runRoutine).not.toHaveBeenCalled()
  })

  it('skips a disabled routine even if nextRunAt has passed', async () => {
    const routine = makeRoutine({ nextRunAt: 100, enabled: false })
    const runRoutine = vi.fn().mockResolvedValue(okResult)
    const scheduler = new RoutineScheduler({
      getRoutines: () => [routine],
      runRoutine,
      onRun: vi.fn(),
      now: () => 200,
    })
    await scheduler.tick()
    expect(runRoutine).not.toHaveBeenCalled()
  })

  it('skips a routine with no nextRunAt (null)', async () => {
    const routine = makeRoutine({ nextRunAt: null })
    const runRoutine = vi.fn().mockResolvedValue(okResult)
    const scheduler = new RoutineScheduler({
      getRoutines: () => [routine],
      runRoutine,
      onRun: vi.fn(),
      now: () => 200,
    })
    await scheduler.tick()
    expect(runRoutine).not.toHaveBeenCalled()
  })

  it('runs multiple due routines sequentially, one at a time', async () => {
    const order: string[] = []
    const a = makeRoutine({ id: 'a', name: 'A', nextRunAt: 1 })
    const b = makeRoutine({ id: 'b', name: 'B', nextRunAt: 1 })
    let releaseA: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (releaseA = resolve))
    const runRoutine = vi.fn(async (r: RoutineEntry) => {
      order.push(`start:${r.id}`)
      if (r.id === 'a') await gate
      order.push(`end:${r.id}`)
      return okResult
    })
    const scheduler = new RoutineScheduler({
      getRoutines: () => [a, b],
      runRoutine,
      onRun: vi.fn(),
      now: () => 100,
    })
    const tickPromise = scheduler.tick()
    // b must not start until a's run has settled — sequential, not concurrent.
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['start:a'])
    releaseA()
    await tickPromise
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
  })

  it('does not re-fire a routine still running from a previous tick', async () => {
    const routine = makeRoutine({ nextRunAt: 1 })
    let releaseFirst: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve))
    const runRoutine = vi.fn(async () => {
      await gate
      return okResult
    })
    const scheduler = new RoutineScheduler({
      getRoutines: () => [routine],
      runRoutine,
      onRun: vi.fn(),
      now: () => 100,
    })
    const firstTick = scheduler.tick()
    await Promise.resolve()
    // A second tick fires while the first routine run is still in flight.
    await scheduler.tick()
    expect(runRoutine).toHaveBeenCalledTimes(1)
    releaseFirst()
    await firstTick
  })

  it('ignores a concurrent tick() call while one is already in progress (re-entrancy guard)', async () => {
    const routine = makeRoutine({ nextRunAt: 1 })
    const getRoutines = vi.fn(() => [routine])
    let releaseRun: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (releaseRun = resolve))
    const runRoutine = vi.fn(async () => {
      await gate
      return okResult
    })
    const scheduler = new RoutineScheduler({
      getRoutines,
      runRoutine,
      onRun: vi.fn(),
      now: () => 100,
    })
    const first = scheduler.tick()
    await Promise.resolve()
    const second = scheduler.tick()
    releaseRun()
    await Promise.all([first, second])
    // The second, overlapping tick() bailed out immediately without polling getRoutines again.
    expect(getRoutines).toHaveBeenCalledTimes(1)
  })
})

describe('RoutineScheduler.start/stop', () => {
  it('fires an immediate tick on start, without waiting for the first interval', async () => {
    vi.useFakeTimers()
    const routine = makeRoutine({ nextRunAt: 1 })
    const runRoutine = vi.fn().mockResolvedValue(okResult)
    const scheduler = new RoutineScheduler({
      getRoutines: () => [routine],
      runRoutine,
      onRun: vi.fn(),
      now: () => 100,
      tickMs: 30_000,
    })
    scheduler.start()
    await vi.waitFor(() => expect(runRoutine).toHaveBeenCalledTimes(1))
    scheduler.stop()
  })

  it('polls again after tickMs elapses', async () => {
    vi.useFakeTimers()
    const routine = makeRoutine({ nextRunAt: 1 })
    const runRoutine = vi.fn().mockResolvedValue(okResult)
    const scheduler = new RoutineScheduler({
      getRoutines: () => [routine],
      runRoutine,
      onRun: vi.fn(),
      now: () => 100,
      tickMs: 1000,
    })
    scheduler.start()
    await vi.waitFor(() => expect(runRoutine).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(1000)
    expect(runRoutine).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('stop() prevents any further polling', async () => {
    vi.useFakeTimers()
    const routine = makeRoutine({ nextRunAt: 1 })
    const runRoutine = vi.fn().mockResolvedValue(okResult)
    const scheduler = new RoutineScheduler({
      getRoutines: () => [routine],
      runRoutine,
      onRun: vi.fn(),
      now: () => 100,
      tickMs: 1000,
    })
    scheduler.start()
    await vi.waitFor(() => expect(runRoutine).toHaveBeenCalledTimes(1))
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(runRoutine).toHaveBeenCalledTimes(1)
  })

  it('calling start() twice does not create a second timer', async () => {
    vi.useFakeTimers()
    const routine = makeRoutine({ nextRunAt: 1 })
    const runRoutine = vi.fn().mockResolvedValue(okResult)
    const scheduler = new RoutineScheduler({
      getRoutines: () => [routine],
      runRoutine,
      onRun: vi.fn(),
      now: () => 100,
      tickMs: 1000,
    })
    scheduler.start()
    await vi.waitFor(() => expect(runRoutine).toHaveBeenCalledTimes(1))
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000)
    // Exactly one poll per elapsed interval, not two, even though start() was called twice.
    expect(runRoutine).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })
})
