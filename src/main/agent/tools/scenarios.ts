import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Notification } from 'electron'
import type { ScenarioEntry, ScenarioStep } from '@shared/events'
import { openTarget } from './apps'

/** The only InputDriver methods a scenario's 'key'/'type' steps need — narrower than the full driver so a test double doesn't have to implement the rest. */
export interface ScenarioInputDriver {
  pressKeys(keys: string[]): Promise<void>
  typeText(text: string): Promise<void>
}

const MAX_SCENARIOS = 100
const MAX_STEPS = 30
const MAX_WAIT_MS = 30_000

export function loadScenarioEntries(file: string): ScenarioEntry[] {
  try {
    if (!existsSync(file)) return []
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(raw) ? (raw as ScenarioEntry[]) : []
  } catch {
    return []
  }
}

export function saveScenarioEntries(file: string, entries: ScenarioEntry[]): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(entries), 'utf8')
}

export interface ScenarioInput {
  name: string
  description: string
  triggerPhrases: string[]
  steps: ScenarioStep[]
}

function sanitizeStep(step: ScenarioStep): ScenarioStep {
  return {
    kind: step.kind,
    target: step.target?.trim().slice(0, 300) || undefined,
    ms: step.ms !== undefined ? Math.min(Math.max(0, Math.round(step.ms)), MAX_WAIT_MS) : undefined,
    keys: step.keys?.trim().slice(0, 100) || undefined,
    text: step.text?.slice(0, 2000) || undefined,
    title: step.title?.trim().slice(0, 80) || undefined,
    body: step.body?.trim().slice(0, 400) || undefined,
  }
}

function sanitizeInput(input: ScenarioInput): ScenarioInput {
  return {
    name: input.name.trim().slice(0, 80),
    description: input.description.trim().slice(0, 300),
    triggerPhrases: input.triggerPhrases
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 10),
    steps: input.steps.slice(0, MAX_STEPS).map(sanitizeStep),
  }
}

/** Pure — same create-or-update-by-id shape as skills.ts's upsertSkill. */
export function upsertScenario(
  entries: ScenarioEntry[],
  input: ScenarioInput & { enabled?: boolean },
  opts: { id?: string; maxEntries?: number; now?: () => number; genId?: () => string } = {},
): { entries: ScenarioEntry[]; scenario?: ScenarioEntry; error?: string } {
  const { id, maxEntries = MAX_SCENARIOS, now = Date.now, genId = randomUUID } = opts
  const clean = sanitizeInput(input)
  if (!clean.name) return { entries, error: 'name is required' }
  if (!clean.steps.length) return { entries, error: 'at least one step is required' }
  const duplicate = entries.find(
    (e) => e.id !== id && e.name.toLowerCase() === clean.name.toLowerCase(),
  )
  if (duplicate) return { entries, error: `a scenario named "${clean.name}" already exists` }

  if (id) {
    const existing = entries.find((e) => e.id === id)
    if (!existing) return { entries, error: `no scenario with id ${id}` }
    const updated: ScenarioEntry = { ...existing, ...clean, updatedAt: now() }
    return { entries: entries.map((e) => (e.id === id ? updated : e)), scenario: updated }
  }

  if (entries.length >= maxEntries)
    return { entries, error: 'too many scenarios; delete one first' }
  const ts = now()
  const scenario: ScenarioEntry = {
    id: genId(),
    ...clean,
    enabled: input.enabled ?? true,
    createdAt: ts,
    updatedAt: ts,
  }
  return { entries: [...entries, scenario], scenario }
}

export function removeScenario(entries: ScenarioEntry[], id: string): ScenarioEntry[] {
  return entries.filter((e) => e.id !== id)
}

export function setScenarioEnabledPure(
  entries: ScenarioEntry[],
  id: string,
  enabled: boolean,
  now: () => number = Date.now,
): ScenarioEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, enabled, updatedAt: now() } : e))
}

/** Pure — renders enabled scenarios for the system prompt so the model knows what's available and can match intent to a name. */
export function renderScenariosForPrompt(entries: ScenarioEntry[]): string {
  const enabled = entries.filter((e) => e.enabled).sort((a, b) => a.name.localeCompare(b.name))
  return enabled
    .map((e) => {
      const triggers = e.triggerPhrases.length ? ` (e.g. "${e.triggerPhrases.join('", "')}")` : ''
      return `- "${e.name}"${triggers}: ${e.description || `${e.steps.length} step(s)`}`
    })
    .join('\n')
}

export function listScenarios(file: string): ScenarioEntry[] {
  return [...loadScenarioEntries(file)].sort((a, b) => a.name.localeCompare(b.name))
}

export function createScenario(
  file: string,
  input: ScenarioInput,
): { scenario?: ScenarioEntry; error?: string } {
  const result = upsertScenario(loadScenarioEntries(file), input)
  if (result.scenario) saveScenarioEntries(file, result.entries)
  return result
}

export function updateScenario(
  file: string,
  id: string,
  input: ScenarioInput,
): { scenario?: ScenarioEntry; error?: string } {
  const result = upsertScenario(loadScenarioEntries(file), input, { id })
  if (result.scenario) saveScenarioEntries(file, result.entries)
  return result
}

export function deleteScenario(file: string, id: string): void {
  saveScenarioEntries(file, removeScenario(loadScenarioEntries(file), id))
}

export function setScenarioEnabled(file: string, id: string, enabled: boolean): void {
  saveScenarioEntries(file, setScenarioEnabledPure(loadScenarioEntries(file), id, enabled))
}

export function readScenariosForPrompt(file: string): string {
  return renderScenariosForPrompt(loadScenarioEntries(file))
}

function findScenario(entries: ScenarioEntry[], idOrName: string): ScenarioEntry | undefined {
  return (
    entries.find((e) => e.id === idOrName) ??
    entries.find((e) => e.name.toLowerCase() === idOrName.trim().toLowerCase())
  )
}

/**
 * WORK-02: runs a scenario's steps in order, in-process — the same handlers the open/keyboard
 * tools call, not a re-derivation by the model. Stops at the first failing step so a partial
 * failure is reported precisely rather than silently continuing past it.
 */
export async function runScenario(
  file: string,
  idOrName: string,
  deps: { inputDriver: () => Promise<ScenarioInputDriver | null> },
): Promise<{ ran?: string; log?: string[]; error?: string }> {
  const scenario = findScenario(loadScenarioEntries(file), idOrName)
  if (!scenario) return { error: `no scenario named or with id "${idOrName}"` }
  if (!scenario.enabled) return { error: `scenario "${scenario.name}" is disabled` }

  const log: string[] = []
  for (const [i, step] of scenario.steps.entries()) {
    const label = `step ${i + 1}/${scenario.steps.length} (${step.kind})`
    try {
      switch (step.kind) {
        case 'open': {
          if (!step.target) return { error: `${label}: missing target`, log }
          log.push(await openTarget(step.target))
          break
        }
        case 'wait': {
          await new Promise((resolve) => setTimeout(resolve, step.ms ?? 500))
          log.push(`waited ${step.ms ?? 500}ms`)
          break
        }
        case 'key': {
          if (!step.keys) return { error: `${label}: missing keys`, log }
          const driver = await deps.inputDriver()
          if (!driver) return { error: `${label}: no input driver available`, log }
          const combo = step.keys
            .toLowerCase()
            .split('+')
            .map((k) => k.trim())
            .filter(Boolean)
          await driver.pressKeys(combo)
          log.push(`pressed ${combo.join('+')}`)
          break
        }
        case 'type': {
          if (!step.text) return { error: `${label}: missing text`, log }
          const driver = await deps.inputDriver()
          if (!driver) return { error: `${label}: no input driver available`, log }
          await driver.typeText(step.text)
          log.push(`typed ${step.text.length} chars`)
          break
        }
        case 'notify': {
          if (Notification.isSupported())
            new Notification({ title: step.title ?? scenario.name, body: step.body ?? '' }).show()
          log.push('showed notification')
          break
        }
      }
    } catch (err) {
      return { error: `${label} failed: ${(err as Error).message}`, log }
    }
  }
  return { ran: scenario.name, log }
}
