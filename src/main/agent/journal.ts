import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { AgentUiEvent, JournalEntry } from '@shared/events'

const MAX_CONTENT_CHARS = 4_000
const MAX_INPUT_CHARS = 2_000

function truncateStr(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated ${s.length - max} chars]` : s
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/**
 * AG-02: pure reducer over agent UI events into journal entries — no fs/electron dependency, so
 * it's directly unit-testable. A `tool-use` event opens an entry; the matching `tool-result`
 * (correlated by `toolUseId`) fills in its outcome. Returns the SAME array reference when the
 * event doesn't touch the journal (e.g. text deltas), so callers can skip persisting on no-op.
 */
export function applyJournalEvent(
  entries: JournalEntry[],
  event: AgentUiEvent,
  maxEntries: number,
  now: () => number,
): JournalEntry[] {
  if (event.type === 'tool-use') {
    const entry: JournalEntry = {
      id: event.block.toolUseId,
      toolUseId: event.block.toolUseId,
      name: event.block.name,
      input: truncateStr(safeStringify(event.block.input ?? {}), MAX_INPUT_CHARS),
      timestamp: now(),
      parentToolUseId: event.parentToolUseId,
    }
    const next = [...entries, entry]
    return next.length > maxEntries ? next.slice(next.length - maxEntries) : next
  }
  if (event.type === 'tool-result') {
    const idx = entries.findIndex((e) => e.toolUseId === event.toolUseId && !e.result)
    const current = idx === -1 ? undefined : entries[idx]
    if (idx === -1 || !current) return entries
    const next = entries.slice()
    next[idx] = {
      ...current,
      result: {
        content: truncateStr(event.result.content, MAX_CONTENT_CHARS),
        isError: event.result.isError,
        durationMs: event.result.durationMs,
      },
    }
    return next
  }
  return entries
}

/** Persists journal entries as a single bounded JSON array (small enough to rewrite in full on every change). */
export class ActionJournal {
  private entries: JournalEntry[]

  constructor(
    private readonly filePath: string,
    private readonly maxEntries = 500,
  ) {
    this.entries = this.load()
  }

  private load(): JournalEntry[] {
    try {
      if (!existsSync(this.filePath)) return []
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      return Array.isArray(raw) ? (raw as JournalEntry[]) : []
    } catch {
      return []
    }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.entries), 'utf8')
    } catch {
      // best-effort: a journal write failure must never interrupt tool execution
    }
  }

  record(event: AgentUiEvent): void {
    const next = applyJournalEvent(this.entries, event, this.maxEntries, Date.now)
    if (next !== this.entries) {
      this.entries = next
      this.save()
    }
  }

  /** Most recent first. */
  list(): JournalEntry[] {
    return [...this.entries].reverse()
  }

  clear(): void {
    this.entries = []
    this.save()
  }
}
