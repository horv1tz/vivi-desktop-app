import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  aggregateByDay,
  aggregateBySession,
  applyMetricsEvent,
  MetricsStore,
  summarize,
  toCsv,
} from '../../../src/main/agent/metrics'
import type { AgentUiEvent, MetricEntry, TurnResult } from '../../../src/shared/events'

const result = (over: Partial<TurnResult> = {}): AgentUiEvent => ({
  type: 'result',
  result: {
    turnId: 't1',
    subtype: 'success',
    isError: false,
    costUsd: 0.01,
    durationMs: 100,
    numTurns: 1,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...over,
  },
})

const session = (sessionId: string): AgentUiEvent => ({
  type: 'session',
  sessionId,
  state: 'idle',
})

describe('applyMetricsEvent', () => {
  it('records an entry on a result event', () => {
    const next = applyMetricsEvent(
      [],
      result({ turnId: 't1', costUsd: 0.05 }),
      's1',
      500,
      () => 999,
    )
    expect(next).toEqual([
      {
        id: 't1',
        sessionId: 's1',
        timestamp: 999,
        costUsd: 0.05,
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 100,
      },
    ])
  })

  it('defaults costUsd to 0 when the backend never reported one (e.g. third-party ACP agent)', () => {
    const r = result({ costUsd: undefined })
    const next = applyMetricsEvent([], r, 's1', 500, () => 0)
    expect(next[0]!.costUsd).toBe(0)
  })

  it('defaults sessionId to "unknown" when no session event has been seen yet', () => {
    const next = applyMetricsEvent([], result(), null, 500, () => 0)
    expect(next[0]!.sessionId).toBe('unknown')
  })

  it('ignores every other event type, returning the same array reference', () => {
    const entries: MetricEntry[] = []
    expect(applyMetricsEvent(entries, session('s1'), null, 500, () => 0)).toBe(entries)
    expect(applyMetricsEvent(entries, { type: 'state', state: 'idle' }, null, 500, () => 0)).toBe(
      entries,
    )
  })

  it('drops the oldest entry once maxEntries is exceeded', () => {
    let entries: MetricEntry[] = []
    for (let i = 0; i < 5; i++) {
      entries = applyMetricsEvent(entries, result({ turnId: `t${i}` }), 's1', 3, () => i)
    }
    expect(entries.map((e) => e.id)).toEqual(['t2', 't3', 't4'])
  })
})

describe('aggregateByDay', () => {
  it('sums cost/tokens/turns within the same local day', () => {
    const base = new Date(2026, 0, 15, 10, 0, 0).getTime()
    const entries: MetricEntry[] = [
      {
        id: 'a',
        sessionId: 's1',
        timestamp: base,
        costUsd: 0.1,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 1,
      },
      {
        id: 'b',
        sessionId: 's1',
        timestamp: base + 60_000,
        costUsd: 0.2,
        inputTokens: 20,
        outputTokens: 15,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 1,
      },
    ]
    const daily = aggregateByDay(entries)
    expect(daily).toHaveLength(1)
    expect(daily[0]!.costUsd).toBeCloseTo(0.3)
    expect(daily[0]).toMatchObject({ inputTokens: 30, outputTokens: 20, turns: 2 })
  })

  it('splits entries more than a day apart into separate buckets, sorted ascending', () => {
    const day1 = new Date(2026, 0, 15, 10, 0, 0).getTime()
    const day2 = new Date(2026, 0, 17, 10, 0, 0).getTime()
    const entries: MetricEntry[] = [
      {
        id: 'later',
        sessionId: 's1',
        timestamp: day2,
        costUsd: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 0,
      },
      {
        id: 'earlier',
        sessionId: 's1',
        timestamp: day1,
        costUsd: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 0,
      },
    ]
    const daily = aggregateByDay(entries)
    expect(daily).toHaveLength(2)
    expect(daily[0]!.date < daily[1]!.date).toBe(true)
  })
})

describe('aggregateBySession', () => {
  it('groups by sessionId and sorts by most recently active first', () => {
    const entries: MetricEntry[] = [
      {
        id: 'a',
        sessionId: 's1',
        timestamp: 100,
        costUsd: 0.1,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 0,
      },
      {
        id: 'b',
        sessionId: 's2',
        timestamp: 200,
        costUsd: 0.2,
        inputTokens: 2,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 0,
      },
      {
        id: 'c',
        sessionId: 's1',
        timestamp: 150,
        costUsd: 0.3,
        inputTokens: 3,
        outputTokens: 3,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 0,
      },
    ]
    const sessions = aggregateBySession(entries)
    expect(sessions.map((s) => s.sessionId)).toEqual(['s2', 's1'])
    const s1 = sessions.find((s) => s.sessionId === 's1')!
    expect(s1).toMatchObject({ costUsd: 0.4, inputTokens: 4, outputTokens: 4, turns: 2 })
    expect(s1.lastTimestamp).toBe(150)
  })
})

describe('summarize', () => {
  it('totals across all entries and includes daily/session breakdowns', () => {
    const entries: MetricEntry[] = [
      {
        id: 'a',
        sessionId: 's1',
        timestamp: 100,
        costUsd: 0.1,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 0,
      },
    ]
    const s = summarize(entries)
    expect(s.totalCostUsd).toBe(0.1)
    expect(s.totalInputTokens).toBe(10)
    expect(s.totalOutputTokens).toBe(5)
    expect(s.totalTurns).toBe(1)
    expect(s.daily).toHaveLength(1)
    expect(s.sessions).toHaveLength(1)
  })

  it('is all zeroes for an empty history', () => {
    const s = summarize([])
    expect(s).toEqual({
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTurns: 0,
      daily: [],
      sessions: [],
    })
  })
})

describe('toCsv', () => {
  it('emits a header row plus one row per entry', () => {
    const entries: MetricEntry[] = [
      {
        id: 't1',
        sessionId: 's1',
        timestamp: 0,
        costUsd: 0.01,
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        durationMs: 5,
      },
    ]
    const csv = toCsv(entries)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(
      'timestamp,sessionId,turnId,costUsd,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,durationMs',
    )
    expect(lines[1]).toBe(`${new Date(0).toISOString()},s1,t1,0.01,1,2,3,4,5`)
  })

  it('is just the header for no entries', () => {
    expect(toCsv([]).split('\n')).toHaveLength(1)
  })
})

describe('MetricsStore', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vivi-metrics-'))
    file = join(dir, 'metrics.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty when the file does not exist', () => {
    const store = new MetricsStore(file)
    expect(store.list()).toEqual([])
    expect(store.summary().totalTurns).toBe(0)
  })

  it('attaches the most recently seen sessionId to a recorded turn', () => {
    const store = new MetricsStore(file)
    store.record(session('s1'))
    store.record(result({ turnId: 't1' }))
    store.record(session('s2'))
    store.record(result({ turnId: 't2' }))
    const entries = store.list()
    expect(entries.find((e) => e.id === 't1')!.sessionId).toBe('s1')
    expect(entries.find((e) => e.id === 't2')!.sessionId).toBe('s2')
  })

  it('persists across instances and clear() empties both memory and disk', () => {
    const store = new MetricsStore(file)
    store.record(result({ turnId: 't1' }))
    const reloaded = new MetricsStore(file)
    expect(reloaded.list()).toHaveLength(1)
    reloaded.clear()
    expect(reloaded.list()).toEqual([])
    expect(new MetricsStore(file).list()).toEqual([])
  })

  it('exposes a CSV export matching toCsv() over the same entries', () => {
    const store = new MetricsStore(file)
    store.record(result({ turnId: 't1' }))
    expect(store.toCsv()).toBe(toCsv(store.list()))
  })

  it('is null-safe against a corrupt metrics file', () => {
    writeFileSync(file, '{not json')
    const store = new MetricsStore(file)
    expect(store.list()).toEqual([])
  })
})
