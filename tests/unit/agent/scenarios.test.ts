import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScenarioEntry, ScenarioStep } from '../../../src/shared/events'

vi.mock('electron', () => ({
  Notification: Object.assign(
    vi.fn(function MockNotification() {
      return { show: vi.fn() }
    }),
    { isSupported: () => true },
  ),
  shell: { openExternal: vi.fn().mockResolvedValue(undefined), openPath: vi.fn() },
}))

const {
  removeScenario,
  renderScenariosForPrompt,
  runScenario,
  saveScenarioEntries,
  setScenarioEnabledPure,
  upsertScenario,
} = await import('../../../src/main/agent/tools/scenarios')

const openStep: ScenarioStep = { kind: 'open', target: 'https://example.com' }

describe('upsertScenario — create', () => {
  it('creates a new scenario with trimmed fields, enabled by default', () => {
    const { entries, scenario, error } = upsertScenario(
      [],
      {
        name: '  Play music  ',
        description: ' desc ',
        triggerPhrases: [' play  ', ''],
        steps: [openStep],
      },
      { now: () => 100, genId: () => 'a' },
    )
    expect(error).toBeUndefined()
    expect(scenario).toEqual({
      id: 'a',
      name: 'Play music',
      description: 'desc',
      triggerPhrases: ['play'],
      steps: [openStep],
      enabled: true,
      createdAt: 100,
      updatedAt: 100,
    })
    expect(entries).toEqual([scenario])
  })

  it('rejects an empty name or no steps', () => {
    expect(
      upsertScenario([], { name: '', description: '', triggerPhrases: [], steps: [openStep] })
        .error,
    ).toMatch(/name/)
    expect(
      upsertScenario([], { name: 'x', description: '', triggerPhrases: [], steps: [] }).error,
    ).toMatch(/step/)
  })

  it('rejects a duplicate name (case-insensitive), leaving entries untouched', () => {
    const first = upsertScenario(
      [],
      { name: 'Morning', description: '', triggerPhrases: [], steps: [openStep] },
      { genId: () => 'a' },
    )
    const second = upsertScenario(first.entries, {
      name: 'morning',
      description: '',
      triggerPhrases: [],
      steps: [openStep],
    })
    expect(second.error).toMatch(/already exists/)
    expect(second.entries).toBe(first.entries)
  })

  it('caps the number of scenarios', () => {
    let entries: ScenarioEntry[] = []
    for (let i = 0; i < 3; i++) {
      entries = upsertScenario(
        entries,
        { name: `scenario ${i}`, description: '', triggerPhrases: [], steps: [openStep] },
        { maxEntries: 3, genId: () => `id${i}` },
      ).entries
    }
    const result = upsertScenario(
      entries,
      { name: 'one too many', description: '', triggerPhrases: [], steps: [openStep] },
      { maxEntries: 3 },
    )
    expect(result.error).toMatch(/too many/)
    expect(result.entries).toHaveLength(3)
  })
})

describe('upsertScenario — update by id', () => {
  it('replaces fields and bumps updatedAt, keeping id', () => {
    const created = upsertScenario(
      [],
      { name: 'Old', description: 'old', triggerPhrases: [], steps: [openStep] },
      { now: () => 1, genId: () => 'a' },
    )
    const updated = upsertScenario(
      created.entries,
      {
        name: 'New',
        description: 'new',
        triggerPhrases: ['go'],
        steps: [{ kind: 'wait', ms: 500 }],
      },
      { id: 'a', now: () => 2 },
    )
    expect(updated.scenario).toEqual({
      id: 'a',
      name: 'New',
      description: 'new',
      triggerPhrases: ['go'],
      steps: [{ kind: 'wait', ms: 500 }],
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
    })
  })

  it('errors on an unknown id without touching entries', () => {
    const result = upsertScenario(
      [],
      { name: 'x', description: '', triggerPhrases: [], steps: [openStep] },
      { id: 'missing' },
    )
    expect(result.error).toMatch(/no scenario/)
  })
})

describe('removeScenario / setScenarioEnabledPure', () => {
  const a: ScenarioEntry = {
    id: 'a',
    name: 'A',
    description: '',
    triggerPhrases: [],
    steps: [openStep],
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  }
  const b = { ...a, id: 'b', name: 'B' }

  it('removeScenario removes the matching entry only', () => {
    expect(removeScenario([a, b], 'a')).toEqual([b])
  })

  it('setScenarioEnabledPure flips enabled and bumps updatedAt for the matching entry only', () => {
    const result = setScenarioEnabledPure([a, b], 'a', false, () => 99)
    expect(result[0]).toEqual({ ...a, enabled: false, updatedAt: 99 })
    expect(result[1]).toEqual(b)
  })
})

describe('renderScenariosForPrompt', () => {
  const make = (over: Partial<ScenarioEntry>): ScenarioEntry => ({
    id: over.id ?? 'x',
    name: over.name ?? 'X',
    description: over.description ?? '',
    triggerPhrases: over.triggerPhrases ?? [],
    steps: over.steps ?? [openStep],
    enabled: over.enabled ?? true,
    createdAt: over.createdAt ?? 1,
    updatedAt: over.updatedAt ?? 1,
  })

  it('returns an empty string with no entries', () => {
    expect(renderScenariosForPrompt([])).toBe('')
  })

  it('excludes disabled scenarios and includes example trigger phrases', () => {
    const rendered = renderScenariosForPrompt([
      make({ name: 'Music', triggerPhrases: ['play music'], description: 'starts Spotify' }),
      make({ id: 'y', name: 'Hidden', enabled: false }),
    ])
    expect(rendered).toContain('Music')
    expect(rendered).toContain('play music')
    expect(rendered).toContain('starts Spotify')
    expect(rendered).not.toContain('Hidden')
  })

  it('sorts alphabetically by name', () => {
    const rendered = renderScenariosForPrompt([
      make({ id: 'z', name: 'Zebra' }),
      make({ id: 'a', name: 'Apple' }),
    ])
    expect(rendered.indexOf('Apple')).toBeLessThan(rendered.indexOf('Zebra'))
  })
})

describe('runScenario', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const write = (entries: ScenarioEntry[]): string => {
    dir = mkdtempSync(join(tmpdir(), 'vivi-scenarios-'))
    const file = join(dir, 'scenarios.json')
    saveScenarioEntries(file, entries)
    return file
  }

  const fakeDriver = () => ({
    pressKeys: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
  })

  it('errors when no scenario matches the given name or id', async () => {
    const file = write([])
    const result = await runScenario(file, 'missing', { inputDriver: async () => null })
    expect(result.error).toMatch(/no scenario/)
  })

  it('errors when the scenario is disabled', async () => {
    const file = write([
      {
        id: 'a',
        name: 'Disabled',
        description: '',
        triggerPhrases: [],
        steps: [openStep],
        enabled: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    const result = await runScenario(file, 'Disabled', { inputDriver: async () => null })
    expect(result.error).toMatch(/disabled/)
  })

  it('finds a scenario by name (case-insensitive) or by id, and runs open/wait/key/type/notify steps in order', async () => {
    const driver = fakeDriver()
    const file = write([
      {
        id: 'a',
        name: 'Morning routine',
        description: '',
        triggerPhrases: [],
        steps: [
          { kind: 'open', target: 'https://example.com' },
          { kind: 'wait', ms: 1 },
          { kind: 'key', keys: 'ctrl+shift+t' },
          { kind: 'type', text: 'hello' },
          { kind: 'notify', title: 'Done', body: 'all set' },
        ],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    const byName = await runScenario(file, 'morning routine', { inputDriver: async () => driver })
    expect(byName.error).toBeUndefined()
    expect(byName.ran).toBe('Morning routine')
    expect(driver.pressKeys).toHaveBeenCalledWith(['ctrl', 'shift', 't'])
    expect(driver.typeText).toHaveBeenCalledWith('hello')
    expect(byName.log).toEqual([
      'opened URL https://example.com',
      'waited 1ms',
      'pressed ctrl+shift+t',
      'typed 5 chars',
      'showed notification',
    ])

    const byId = await runScenario(file, 'a', { inputDriver: async () => driver })
    expect(byId.ran).toBe('Morning routine')
  })

  it('stops at the first failing step and reports what completed so far', async () => {
    const file = write([
      {
        id: 'a',
        name: 'No driver',
        description: '',
        triggerPhrases: [],
        steps: [
          { kind: 'wait', ms: 1 },
          { kind: 'key', keys: 'space' },
          { kind: 'notify', title: 'unreachable' },
        ],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    const result = await runScenario(file, 'No driver', { inputDriver: async () => null })
    expect(result.error).toMatch(/no input driver/)
    expect(result.log).toEqual(['waited 1ms'])
  })
})
