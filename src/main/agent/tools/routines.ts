import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RoutineEntry, RoutineRunResult, RoutineSchedule } from '@shared/events'

const MAX_ROUTINES = 50
const MIN_INTERVAL_MINUTES = 1
const MAX_INTERVAL_MINUTES = 60 * 24 * 30 // 30 days

export function loadRoutineEntries(file: string): RoutineEntry[] {
  try {
    if (!existsSync(file)) return []
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(raw) ? (raw as RoutineEntry[]) : []
  } catch {
    return []
  }
}

export function saveRoutineEntries(file: string, entries: RoutineEntry[]): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(entries), 'utf8')
}

/**
 * The next time `schedule` fires strictly after `nowMs` — pure, so the scheduler and its tests can
 * share the exact same clock. 'daily' works in the local timezone (a routine set for "9:00" means
 * 9am wherever the machine is, not UTC). Returns null once a 'once' schedule's moment has passed.
 */
export function computeNextRun(schedule: RoutineSchedule, nowMs: number): number | null {
  switch (schedule.kind) {
    case 'once':
      return schedule.at !== undefined && schedule.at > nowMs ? schedule.at : null
    case 'interval': {
      const minutes = Math.max(MIN_INTERVAL_MINUTES, schedule.minutes ?? MIN_INTERVAL_MINUTES)
      return nowMs + minutes * 60_000
    }
    case 'daily': {
      const hour = Math.min(23, Math.max(0, schedule.hour ?? 9))
      const minute = Math.min(59, Math.max(0, schedule.minute ?? 0))
      const next = new Date(nowMs)
      next.setHours(hour, minute, 0, 0)
      if (next.getTime() <= nowMs) next.setDate(next.getDate() + 1)
      return next.getTime()
    }
  }
}

function sanitizeSchedule(schedule: RoutineSchedule): RoutineSchedule {
  switch (schedule.kind) {
    case 'once':
      return { kind: 'once', at: schedule.at !== undefined ? Math.max(0, schedule.at) : undefined }
    case 'interval':
      return {
        kind: 'interval',
        minutes: Math.min(
          MAX_INTERVAL_MINUTES,
          Math.max(MIN_INTERVAL_MINUTES, Math.round(schedule.minutes ?? MIN_INTERVAL_MINUTES)),
        ),
      }
    case 'daily':
      return {
        kind: 'daily',
        hour: Math.min(23, Math.max(0, Math.round(schedule.hour ?? 9))),
        minute: Math.min(59, Math.max(0, Math.round(schedule.minute ?? 0))),
      }
  }
}

export interface RoutineInput {
  name: string
  prompt: string
  schedule: RoutineSchedule
  safeMode?: boolean
}

function sanitizeInput(input: RoutineInput): RoutineInput & { safeMode: boolean } {
  return {
    name: input.name.trim().slice(0, 80),
    prompt: input.prompt.trim().slice(0, 4000),
    schedule: sanitizeSchedule(input.schedule),
    safeMode: input.safeMode ?? true,
  }
}

/** Pure — same create-or-update-by-id shape as scenarios.ts's upsertScenario. */
export function upsertRoutine(
  entries: RoutineEntry[],
  input: RoutineInput & { enabled?: boolean },
  opts: { id?: string; maxEntries?: number; now?: () => number; genId?: () => string } = {},
): { entries: RoutineEntry[]; routine?: RoutineEntry; error?: string } {
  const { id, maxEntries = MAX_ROUTINES, now = Date.now, genId = randomUUID } = opts
  const clean = sanitizeInput(input)
  if (!clean.name) return { entries, error: 'name is required' }
  if (!clean.prompt) return { entries, error: 'prompt is required' }
  if (clean.schedule.kind === 'once' && clean.schedule.at === undefined)
    return { entries, error: 'a one-off routine needs a time' }
  const duplicate = entries.find(
    (e) => e.id !== id && e.name.toLowerCase() === clean.name.toLowerCase(),
  )
  if (duplicate) return { entries, error: `a routine named "${clean.name}" already exists` }

  const enabled = input.enabled ?? true
  const nextRunAt = enabled ? computeNextRun(clean.schedule, now()) : null

  if (id) {
    const existing = entries.find((e) => e.id === id)
    if (!existing) return { entries, error: `no routine with id ${id}` }
    const updated: RoutineEntry = { ...existing, ...clean, enabled, nextRunAt, updatedAt: now() }
    return { entries: entries.map((e) => (e.id === id ? updated : e)), routine: updated }
  }

  if (entries.length >= maxEntries) return { entries, error: 'too many routines; delete one first' }
  const ts = now()
  const routine: RoutineEntry = {
    id: genId(),
    ...clean,
    enabled,
    nextRunAt,
    createdAt: ts,
    updatedAt: ts,
  }
  return { entries: [...entries, routine], routine }
}

export function removeRoutine(entries: RoutineEntry[], id: string): RoutineEntry[] {
  return entries.filter((e) => e.id !== id)
}

export function setRoutineEnabledPure(
  entries: RoutineEntry[],
  id: string,
  enabled: boolean,
  now: () => number = Date.now,
): RoutineEntry[] {
  return entries.map((e) =>
    e.id === id
      ? {
          ...e,
          enabled,
          nextRunAt: enabled ? computeNextRun(e.schedule, now()) : null,
          updatedAt: now(),
        }
      : e,
  )
}

/** Records a run's outcome and reschedules — the scheduler's own persistence step after firing. */
export function recordRoutineRunPure(
  entries: RoutineEntry[],
  id: string,
  result: RoutineRunResult,
  now: () => number = Date.now,
): RoutineEntry[] {
  return entries.map((e) => {
    if (e.id !== id) return e
    const stillEnabled = e.enabled && e.schedule.kind !== 'once'
    return {
      ...e,
      lastRun: result,
      enabled: stillEnabled,
      nextRunAt: stillEnabled ? computeNextRun(e.schedule, now()) : null,
      updatedAt: now(),
    }
  })
}

export function listRoutines(file: string): RoutineEntry[] {
  return [...loadRoutineEntries(file)].sort((a, b) => a.name.localeCompare(b.name))
}

export function createRoutine(
  file: string,
  input: RoutineInput,
): { routine?: RoutineEntry; error?: string } {
  const result = upsertRoutine(loadRoutineEntries(file), input)
  if (result.routine) saveRoutineEntries(file, result.entries)
  return result
}

export function updateRoutine(
  file: string,
  id: string,
  input: RoutineInput,
): { routine?: RoutineEntry; error?: string } {
  const result = upsertRoutine(loadRoutineEntries(file), input, { id })
  if (result.routine) saveRoutineEntries(file, result.entries)
  return result
}

export function deleteRoutine(file: string, id: string): void {
  saveRoutineEntries(file, removeRoutine(loadRoutineEntries(file), id))
}

export function setRoutineEnabled(file: string, id: string, enabled: boolean): void {
  saveRoutineEntries(file, setRoutineEnabledPure(loadRoutineEntries(file), id, enabled))
}

export function recordRoutineRun(file: string, id: string, result: RoutineRunResult): void {
  saveRoutineEntries(file, recordRoutineRunPure(loadRoutineEntries(file), id, result))
}

function findRoutine(entries: RoutineEntry[], idOrName: string): RoutineEntry | undefined {
  return (
    entries.find((e) => e.id === idOrName) ??
    entries.find((e) => e.name.toLowerCase() === idOrName.trim().toLowerCase())
  )
}

/** Pure — renders enabled routines for the system prompt, same convention as scenarios/skills. */
export function renderRoutinesForPrompt(entries: RoutineEntry[]): string {
  const enabled = entries.filter((e) => e.enabled).sort((a, b) => a.name.localeCompare(b.name))
  return enabled
    .map((e) => {
      const next = e.nextRunAt ? ` — next run ${new Date(e.nextRunAt).toISOString()}` : ''
      return `- "${e.name}"${next}: ${e.prompt.slice(0, 120)}`
    })
    .join('\n')
}

export function readRoutinesForPrompt(file: string): string {
  return renderRoutinesForPrompt(loadRoutineEntries(file))
}

export function findRoutineByIdOrName(file: string, idOrName: string): RoutineEntry | undefined {
  return findRoutine(loadRoutineEntries(file), idOrName)
}
