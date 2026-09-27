import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type {
  AgentUiEvent,
  MetricEntry,
  MetricsDailyTotal,
  MetricsSessionTotal,
  MetricsSummary,
} from '@shared/events'

/**
 * OBS-02: pure reducer over agent UI events into metric entries — no fs/electron dependency, so
 * it's directly unit-testable. Only `result` events produce an entry: cost/tokens are reported by
 * the backend once per completed turn, never per tool call, so that's the finest grain available.
 * `sessionId` is threaded in separately (from the last `session` event) rather than read off the
 * `result` event itself, since `TurnResult` doesn't carry one. Returns the SAME array reference
 * when the event isn't a `result`, so callers can skip persisting on no-op.
 */
export function applyMetricsEvent(
  entries: MetricEntry[],
  event: AgentUiEvent,
  sessionId: string | null,
  maxEntries: number,
  now: () => number,
): MetricEntry[] {
  if (event.type !== 'result') return entries
  const r = event.result
  const entry: MetricEntry = {
    id: r.turnId,
    sessionId: sessionId ?? 'unknown',
    timestamp: now(),
    costUsd: r.costUsd ?? 0,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    durationMs: r.durationMs,
  }
  const next = [...entries, entry]
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next
}

function localDateKey(timestamp: number): string {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function aggregateByDay(entries: MetricEntry[]): MetricsDailyTotal[] {
  const map = new Map<string, MetricsDailyTotal>()
  for (const e of entries) {
    const date = localDateKey(e.timestamp)
    const cur = map.get(date) ?? { date, costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 }
    cur.costUsd += e.costUsd
    cur.inputTokens += e.inputTokens
    cur.outputTokens += e.outputTokens
    cur.turns += 1
    map.set(date, cur)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function aggregateBySession(entries: MetricEntry[]): MetricsSessionTotal[] {
  const map = new Map<string, MetricsSessionTotal>()
  for (const e of entries) {
    const cur = map.get(e.sessionId) ?? {
      sessionId: e.sessionId,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
      lastTimestamp: 0,
    }
    cur.costUsd += e.costUsd
    cur.inputTokens += e.inputTokens
    cur.outputTokens += e.outputTokens
    cur.turns += 1
    cur.lastTimestamp = Math.max(cur.lastTimestamp, e.timestamp)
    map.set(e.sessionId, cur)
  }
  return [...map.values()].sort((a, b) => b.lastTimestamp - a.lastTimestamp)
}

export function summarize(entries: MetricEntry[]): MetricsSummary {
  return {
    totalCostUsd: entries.reduce((s, e) => s + e.costUsd, 0),
    totalInputTokens: entries.reduce((s, e) => s + e.inputTokens, 0),
    totalOutputTokens: entries.reduce((s, e) => s + e.outputTokens, 0),
    totalTurns: entries.length,
    daily: aggregateByDay(entries),
    sessions: aggregateBySession(entries),
  }
}

const CSV_HEADER =
  'timestamp,sessionId,turnId,costUsd,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,durationMs'

/** IDs are internal UUIDs (no commas/quotes), so no CSV escaping is needed for them. */
export function toCsv(entries: MetricEntry[]): string {
  const rows = entries.map((e) =>
    [
      new Date(e.timestamp).toISOString(),
      e.sessionId,
      e.id,
      e.costUsd,
      e.inputTokens,
      e.outputTokens,
      e.cacheReadTokens,
      e.cacheWriteTokens,
      e.durationMs,
    ].join(','),
  )
  return [CSV_HEADER, ...rows].join('\n')
}

/** Persists metric entries as a single bounded JSON array (small enough to rewrite in full on every change). */
export class MetricsStore {
  private entries: MetricEntry[]
  private currentSessionId: string | null = null

  constructor(
    private readonly filePath: string,
    private readonly maxEntries = 5_000,
  ) {
    this.entries = this.load()
  }

  private load(): MetricEntry[] {
    try {
      if (!existsSync(this.filePath)) return []
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      return Array.isArray(raw) ? (raw as MetricEntry[]) : []
    } catch {
      return []
    }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.entries), 'utf8')
    } catch {
      // best-effort: a metrics write failure must never interrupt tool execution
    }
  }

  record(event: AgentUiEvent): void {
    if (event.type === 'session') this.currentSessionId = event.sessionId
    const next = applyMetricsEvent(
      this.entries,
      event,
      this.currentSessionId,
      this.maxEntries,
      Date.now,
    )
    if (next !== this.entries) {
      this.entries = next
      this.save()
    }
  }

  list(): MetricEntry[] {
    return [...this.entries]
  }

  summary(): MetricsSummary {
    return summarize(this.entries)
  }

  toCsv(): string {
    return toCsv(this.entries)
  }

  clear(): void {
    this.entries = []
    this.save()
  }
}
