import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MemoryEntry, MemoryEntryType } from '@shared/events'

const MAX_ENTRIES = 300
const DEFAULT_PROMPT_BUDGET_CHARS = 4_000

export function loadMemoryEntries(file: string): MemoryEntry[] {
  try {
    if (!existsSync(file)) return []
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(raw) ? (raw as MemoryEntry[]) : []
  } catch {
    return []
  }
}

export function saveMemoryEntries(file: string, entries: MemoryEntry[]): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(entries), 'utf8')
}

/**
 * AG-03: pure — appends a new entry (deduping identical type+text), capped at maxEntries (oldest
 * dropped first once full). No fs dependency, so it's directly unit-testable.
 */
export function addMemoryEntry(
  entries: MemoryEntry[],
  input: { type: MemoryEntryType; text: string },
  opts: { maxEntries?: number; now?: () => number; id?: () => string } = {},
): { entries: MemoryEntry[]; added: boolean } {
  const { maxEntries = MAX_ENTRIES, now = Date.now, id = randomUUID } = opts
  const text = input.text.trim().replace(/\s+/g, ' ')
  if (entries.some((e) => e.type === input.type && e.text === text))
    return { entries, added: false }
  const entry: MemoryEntry = { id: id(), type: input.type, text, createdAt: now() }
  const next = [...entries, entry]
  return {
    entries: next.length > maxEntries ? next.slice(next.length - maxEntries) : next,
    added: true,
  }
}

export function removeMemoryEntry(entries: MemoryEntry[], id: string): MemoryEntry[] {
  return entries.filter((e) => e.id !== id)
}

/**
 * AG-03: pure — renders entries for the system prompt, most-recent-first, stopping once the
 * character budget is spent. The previous VIVI.md implementation kept the FIRST N characters of
 * an ever-growing file, so old facts (written first) always survived while new ones (appended at
 * the end) silently fell off the prompt — the opposite of what you want from a memory that's
 * supposed to stay current.
 */
export function renderMemoryForPrompt(
  entries: MemoryEntry[],
  maxChars = DEFAULT_PROMPT_BUDGET_CHARS,
): string {
  const byRecency = [...entries].sort((a, b) => b.createdAt - a.createdAt)
  const lines: string[] = []
  let used = 0
  for (const e of byRecency) {
    const line = `- [${e.type}] ${e.text}`
    if (used + line.length + 1 > maxChars) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

export function rememberEntry(file: string, type: MemoryEntryType, text: string): string {
  const { entries, added } = addMemoryEntry(loadMemoryEntries(file), { type, text })
  if (!added) return 'already remembered'
  saveMemoryEntries(file, entries)
  return `remembered: ${text.trim()}`
}

/** Most recent first. */
export function listMemoryEntries(file: string): MemoryEntry[] {
  return [...loadMemoryEntries(file)].sort((a, b) => b.createdAt - a.createdAt)
}

export function deleteMemoryEntry(file: string, id: string): void {
  saveMemoryEntries(file, removeMemoryEntry(loadMemoryEntries(file), id))
}

export function clearMemoryEntries(file: string): void {
  saveMemoryEntries(file, [])
}

export function readMemoryForPrompt(file: string, maxChars?: number): string {
  return renderMemoryForPrompt(loadMemoryEntries(file), maxChars)
}
