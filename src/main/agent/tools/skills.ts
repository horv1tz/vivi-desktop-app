import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SkillEntry } from '@shared/events'

const MAX_SKILLS = 100
const MAX_BODY_CHARS = 8_000
const DEFAULT_PROMPT_BUDGET_CHARS = 12_000

export function loadSkillEntries(file: string): SkillEntry[] {
  try {
    if (!existsSync(file)) return []
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(raw) ? (raw as SkillEntry[]) : []
  } catch {
    return []
  }
}

export function saveSkillEntries(file: string, entries: SkillEntry[]): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(entries), 'utf8')
}

export interface SkillInput {
  name: string
  description: string
  body: string
}

/** Trims fields and enforces the same length/count limits regardless of caller (tool or UI). */
function sanitizeInput(input: SkillInput): SkillInput {
  return {
    name: input.name.trim().slice(0, 80),
    description: input.description.trim().slice(0, 300),
    body: input.body.trim().slice(0, MAX_BODY_CHARS),
  }
}

/**
 * Pure — creates a new skill (or, if `id` is given for an update, replaces one by id). No fs
 * dependency, directly unit-testable. Errors (returned, not thrown) cover the cases a caller
 * needs to relay back to the user/agent: empty name/body, duplicate name, unknown id, too many
 * skills already.
 */
export function upsertSkill(
  entries: SkillEntry[],
  input: SkillInput & { source: SkillEntry['source']; enabled?: boolean },
  opts: { id?: string; maxEntries?: number; now?: () => number; genId?: () => string } = {},
): { entries: SkillEntry[]; skill?: SkillEntry; error?: string } {
  const { id, maxEntries = MAX_SKILLS, now = Date.now, genId = randomUUID } = opts
  const clean = sanitizeInput(input)
  if (!clean.name) return { entries, error: 'name is required' }
  if (!clean.body) return { entries, error: 'body is required' }
  const duplicate = entries.find(
    (e) => e.id !== id && e.name.toLowerCase() === clean.name.toLowerCase(),
  )
  if (duplicate) return { entries, error: `a skill named "${clean.name}" already exists` }

  if (id) {
    const existing = entries.find((e) => e.id === id)
    if (!existing) return { entries, error: `no skill with id ${id}` }
    const updated: SkillEntry = { ...existing, ...clean, updatedAt: now() }
    return { entries: entries.map((e) => (e.id === id ? updated : e)), skill: updated }
  }

  if (entries.length >= maxEntries) return { entries, error: 'too many skills; delete one first' }
  const ts = now()
  const skill: SkillEntry = {
    id: genId(),
    ...clean,
    enabled: input.enabled ?? true,
    source: input.source,
    createdAt: ts,
    updatedAt: ts,
  }
  return { entries: [...entries, skill], skill }
}

export function removeSkill(entries: SkillEntry[], id: string): SkillEntry[] {
  return entries.filter((e) => e.id !== id)
}

export function setSkillEnabledPure(
  entries: SkillEntry[],
  id: string,
  enabled: boolean,
  now: () => number = Date.now,
): SkillEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, enabled, updatedAt: now() } : e))
}

/**
 * Pure — renders enabled skills for the system prompt, alphabetical by name for a stable order
 * turn to turn, stopping once the character budget is spent (a skill list that keeps growing must
 * never silently blow the prompt budget the way the old unbounded VIVI.md file did — see
 * memory.ts's own note on the same failure mode).
 */
export function renderSkillsForPrompt(
  entries: SkillEntry[],
  maxChars = DEFAULT_PROMPT_BUDGET_CHARS,
): string {
  const enabled = entries.filter((e) => e.enabled).sort((a, b) => a.name.localeCompare(b.name))
  const blocks: string[] = []
  let used = 0
  for (const e of enabled) {
    const block = `### ${e.name}\n${e.description ? `${e.description}\n` : ''}${e.body}`
    if (used + block.length + 2 > maxChars) break
    blocks.push(block)
    used += block.length + 2
  }
  return blocks.join('\n\n')
}

export function listSkills(file: string): SkillEntry[] {
  return [...loadSkillEntries(file)].sort((a, b) => a.name.localeCompare(b.name))
}

export function createSkill(
  file: string,
  input: SkillInput & { source: SkillEntry['source'] },
): { skill?: SkillEntry; error?: string } {
  const result = upsertSkill(loadSkillEntries(file), input)
  if (result.skill) saveSkillEntries(file, result.entries)
  return result
}

export function updateSkill(
  file: string,
  id: string,
  input: SkillInput,
): { skill?: SkillEntry; error?: string } {
  const entries = loadSkillEntries(file)
  const existing = entries.find((e) => e.id === id)
  const result = upsertSkill(entries, { ...input, source: existing?.source ?? 'user' }, { id })
  if (result.skill) saveSkillEntries(file, result.entries)
  return result
}

export function deleteSkill(file: string, id: string): void {
  saveSkillEntries(file, removeSkill(loadSkillEntries(file), id))
}

export function setSkillEnabled(file: string, id: string, enabled: boolean): void {
  saveSkillEntries(file, setSkillEnabledPure(loadSkillEntries(file), id, enabled))
}

export function readSkillsForPrompt(file: string, maxChars?: number): string {
  return renderSkillsForPrompt(loadSkillEntries(file), maxChars)
}
