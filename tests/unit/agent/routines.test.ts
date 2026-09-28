import { describe, expect, it } from 'vitest'
import type { RoutineEntry, RoutineSchedule } from '../../../src/shared/events'
import {
  computeNextRun,
  recordRoutineRunPure,
  removeRoutine,
  renderRoutinesForPrompt,
  setRoutineEnabledPure,
  upsertRoutine,
} from '../../../src/main/agent/tools/routines'

describe('computeNextRun', () => {
  it('once: returns the moment when still in the future, null once it has passed', () => {
    const now = 1_000_000
    expect(computeNextRun({ kind: 'once', at: now + 1 }, now)).toBe(now + 1)
    expect(computeNextRun({ kind: 'once', at: now }, now)).toBeNull()
    expect(computeNextRun({ kind: 'once', at: now - 1 }, now)).toBeNull()
    expect(computeNextRun({ kind: 'once' }, now)).toBeNull()
  })

  it('interval: now plus minutes, clamped to at least one minute', () => {
    const now = 1_000_000
    expect(computeNextRun({ kind: 'interval', minutes: 30 }, now)).toBe(now + 30 * 60_000)
    expect(computeNextRun({ kind: 'interval', minutes: 0 }, now)).toBe(now + 60_000)
    expect(computeNextRun({ kind: 'interval' }, now)).toBe(now + 60_000)
  })

  it('daily: today at hour:minute if still ahead, otherwise tomorrow', () => {
    const today9am = new Date(2026, 5, 15, 9, 0, 0, 0).getTime()
    const beforeIt = new Date(2026, 5, 15, 8, 0, 0, 0).getTime()
    const afterIt = new Date(2026, 5, 15, 10, 0, 0, 0).getTime()

    const next = computeNextRun({ kind: 'daily', hour: 9, minute: 0 }, beforeIt)
    expect(next).toBe(today9am)

    const rolled = computeNextRun({ kind: 'daily', hour: 9, minute: 0 }, afterIt)
    expect(rolled).toBe(new Date(2026, 5, 16, 9, 0, 0, 0).getTime())
  })

  it('daily: clamps out-of-range hour/minute', () => {
    const now = new Date(2026, 5, 15, 0, 0, 0, 0).getTime()
    const next = computeNextRun({ kind: 'daily', hour: 99, minute: -5 }, now)
    expect(next).toBe(new Date(2026, 5, 15, 23, 0, 0, 0).getTime())
  })
})

describe('upsertRoutine — create', () => {
  it('creates a new routine with trimmed fields, enabled and scheduled by default', () => {
    const { entries, routine, error } = upsertRoutine(
      [],
      {
        name: '  Morning digest  ',
        prompt: ' summarize overnight email ',
        schedule: { kind: 'daily', hour: 9, minute: 0 },
      },
      { now: () => 100, genId: () => 'a' },
    )
    expect(error).toBeUndefined()
    expect(routine).toEqual({
      id: 'a',
      name: 'Morning digest',
      prompt: 'summarize overnight email',
      schedule: { kind: 'daily', hour: 9, minute: 0 },
      safeMode: true,
      enabled: true,
      nextRunAt: computeNextRun({ kind: 'daily', hour: 9, minute: 0 }, 100),
      createdAt: 100,
      updatedAt: 100,
    })
    expect(entries).toEqual([routine])
  })

  it('rejects an empty name or prompt', () => {
    expect(
      upsertRoutine([], {
        name: '',
        prompt: 'x',
        schedule: { kind: 'interval', minutes: 60 },
      }).error,
    ).toMatch(/name/)
    expect(
      upsertRoutine([], {
        name: 'x',
        prompt: '',
        schedule: { kind: 'interval', minutes: 60 },
      }).error,
    ).toMatch(/prompt/)
  })

  it('rejects a one-off routine with no time', () => {
    const result = upsertRoutine([], { name: 'x', prompt: 'y', schedule: { kind: 'once' } })
    expect(result.error).toMatch(/time/)
  })

  it('rejects a duplicate name (case-insensitive), leaving entries untouched', () => {
    const first = upsertRoutine(
      [],
      { name: 'Digest', prompt: 'a', schedule: { kind: 'interval', minutes: 60 } },
      { genId: () => 'a' },
    )
    const second = upsertRoutine(first.entries, {
      name: 'digest',
      prompt: 'b',
      schedule: { kind: 'interval', minutes: 60 },
    })
    expect(second.error).toMatch(/already exists/)
    expect(second.entries).toBe(first.entries)
  })

  it('caps the number of routines', () => {
    let entries: RoutineEntry[] = []
    for (let i = 0; i < 3; i++) {
      entries = upsertRoutine(
        entries,
        { name: `routine ${i}`, prompt: 'p', schedule: { kind: 'interval', minutes: 60 } },
        { maxEntries: 3, genId: () => `id${i}` },
      ).entries
    }
    const result = upsertRoutine(
      entries,
      { name: 'one too many', prompt: 'p', schedule: { kind: 'interval', minutes: 60 } },
      { maxEntries: 3 },
    )
    expect(result.error).toMatch(/too many/)
    expect(result.entries).toHaveLength(3)
  })

  it('does not schedule a routine created disabled', () => {
    const { routine } = upsertRoutine(
      [],
      { name: 'Off', prompt: 'p', schedule: { kind: 'interval', minutes: 60 }, enabled: false },
      { now: () => 100, genId: () => 'a' },
    )
    expect(routine?.enabled).toBe(false)
    expect(routine?.nextRunAt).toBeNull()
  })
})

describe('upsertRoutine — update by id', () => {
  it('replaces fields and bumps updatedAt, keeping id and createdAt', () => {
    const created = upsertRoutine(
      [],
      { name: 'Old', prompt: 'old', schedule: { kind: 'interval', minutes: 60 } },
      { now: () => 1, genId: () => 'a' },
    )
    const updated = upsertRoutine(
      created.entries,
      { name: 'New', prompt: 'new', schedule: { kind: 'daily', hour: 8, minute: 30 } },
      { id: 'a', now: () => 2 },
    )
    expect(updated.routine).toEqual({
      id: 'a',
      name: 'New',
      prompt: 'new',
      schedule: { kind: 'daily', hour: 8, minute: 30 },
      safeMode: true,
      enabled: true,
      nextRunAt: computeNextRun({ kind: 'daily', hour: 8, minute: 30 }, 2),
      createdAt: 1,
      updatedAt: 2,
    })
  })

  it('errors on an unknown id without touching entries', () => {
    const result = upsertRoutine(
      [],
      { name: 'x', prompt: 'y', schedule: { kind: 'interval', minutes: 60 } },
      { id: 'missing' },
    )
    expect(result.error).toMatch(/no routine/)
  })
})

const baseSchedule: RoutineSchedule = { kind: 'interval', minutes: 60 }

function makeRoutine(over: Partial<RoutineEntry> = {}): RoutineEntry {
  return {
    id: over.id ?? 'a',
    name: over.name ?? 'A',
    prompt: over.prompt ?? 'do something',
    schedule: over.schedule ?? baseSchedule,
    safeMode: over.safeMode ?? true,
    enabled: over.enabled ?? true,
    nextRunAt: over.nextRunAt ?? 1,
    lastRun: over.lastRun,
    createdAt: over.createdAt ?? 1,
    updatedAt: over.updatedAt ?? 1,
  }
}

describe('removeRoutine / setRoutineEnabledPure', () => {
  const a = makeRoutine({ id: 'a' })
  const b = makeRoutine({ id: 'b', name: 'B' })

  it('removeRoutine removes the matching entry only', () => {
    expect(removeRoutine([a, b], 'a')).toEqual([b])
  })

  it('setRoutineEnabledPure disabling nulls nextRunAt', () => {
    const result = setRoutineEnabledPure([a, b], 'a', false, () => 99)
    expect(result[0]).toEqual({ ...a, enabled: false, nextRunAt: null, updatedAt: 99 })
    expect(result[1]).toEqual(b)
  })

  it('setRoutineEnabledPure enabling recomputes nextRunAt from the schedule', () => {
    const disabled = makeRoutine({ id: 'a', enabled: false, nextRunAt: null })
    const result = setRoutineEnabledPure([disabled], 'a', true, () => 100)
    expect(result[0]!.enabled).toBe(true)
    expect(result[0]!.nextRunAt).toBe(computeNextRun(baseSchedule, 100))
  })
})

describe('recordRoutineRunPure', () => {
  it('records lastRun and reschedules a recurring (interval) routine', () => {
    const routine = makeRoutine({ schedule: { kind: 'interval', minutes: 15 } })
    const result = recordRoutineRunPure(
      [routine],
      'a',
      { timestamp: 500, summary: 'done', isError: false },
      () => 500,
    )
    expect(result[0]!.lastRun).toEqual({ timestamp: 500, summary: 'done', isError: false })
    expect(result[0]!.enabled).toBe(true)
    expect(result[0]!.nextRunAt).toBe(500 + 15 * 60_000)
  })

  it('auto-disables a one-off routine after it fires, and nulls nextRunAt', () => {
    const routine = makeRoutine({ schedule: { kind: 'once', at: 200 } })
    const result = recordRoutineRunPure(
      [routine],
      'a',
      { timestamp: 200, summary: 'done', isError: false },
      () => 200,
    )
    expect(result[0]!.enabled).toBe(false)
    expect(result[0]!.nextRunAt).toBeNull()
    expect(result[0]!.lastRun?.summary).toBe('done')
  })

  it('leaves other entries untouched', () => {
    const a = makeRoutine({ id: 'a' })
    const b = makeRoutine({ id: 'b' })
    const result = recordRoutineRunPure(
      [a, b],
      'a',
      { timestamp: 1, summary: 'x', isError: true },
      () => 1,
    )
    expect(result[1]).toEqual(b)
  })
})

describe('renderRoutinesForPrompt', () => {
  it('returns an empty string with no entries', () => {
    expect(renderRoutinesForPrompt([])).toBe('')
  })

  it('excludes disabled routines and includes the next run time for enabled ones', () => {
    const rendered = renderRoutinesForPrompt([
      makeRoutine({ id: 'x', name: 'Digest', nextRunAt: 1_700_000_000_000 }),
      makeRoutine({ id: 'y', name: 'Hidden', enabled: false }),
    ])
    expect(rendered).toContain('Digest')
    expect(rendered).not.toContain('Hidden')
  })

  it('sorts alphabetically by name', () => {
    const rendered = renderRoutinesForPrompt([
      makeRoutine({ id: 'z', name: 'Zebra' }),
      makeRoutine({ id: 'a', name: 'Apple' }),
    ])
    expect(rendered.indexOf('Apple')).toBeLessThan(rendered.indexOf('Zebra'))
  })
})
