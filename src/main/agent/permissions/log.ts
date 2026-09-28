import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { PermissionLogEntry, PermissionLogReason } from '@shared/events'

const MAX_INPUT_CHARS = 500

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

export interface DecisionInput {
  toolName: string
  input: Record<string, unknown>
  verdict: 'allow' | 'deny'
  reason: PermissionLogReason
}

/** Pure — same append-and-cap shape as journal.ts's applyJournalEvent, directly unit-testable. */
export function appendLogEntry(
  entries: PermissionLogEntry[],
  decision: DecisionInput,
  maxEntries: number,
  now: () => number = Date.now,
  genId: () => string = randomUUID,
): PermissionLogEntry[] {
  const entry: PermissionLogEntry = {
    id: genId(),
    timestamp: now(),
    toolName: decision.toolName,
    input: truncateStr(safeStringify(decision.input), MAX_INPUT_CHARS),
    verdict: decision.verdict,
    reason: decision.reason,
  }
  const next = [...entries, entry]
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next
}

/** SEC-03: persisted log of permission verdicts (rule/setting-decided or user-in-dialog), same bounded-JSON-file pattern as ActionJournal. */
export class PermissionLog {
  private entries: PermissionLogEntry[]

  constructor(
    private readonly filePath: string,
    private readonly maxEntries = 500,
  ) {
    this.entries = this.load()
  }

  private load(): PermissionLogEntry[] {
    try {
      if (!existsSync(this.filePath)) return []
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      return Array.isArray(raw) ? (raw as PermissionLogEntry[]) : []
    } catch {
      return []
    }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.entries), 'utf8')
    } catch {
      // best-effort: a log write failure must never interrupt a permission decision
    }
  }

  record(decision: DecisionInput): void {
    this.entries = appendLogEntry(this.entries, decision, this.maxEntries)
    this.save()
  }

  /** Most recent first. */
  list(): PermissionLogEntry[] {
    return [...this.entries].reverse()
  }

  clear(): void {
    this.entries = []
    this.save()
  }
}
