import { describe, expect, it } from 'vitest'
import {
  removeSkill,
  renderSkillsForPrompt,
  setSkillEnabledPure,
  upsertSkill,
} from '../../../src/main/agent/tools/skills'
import type { SkillEntry } from '../../../src/shared/events'

describe('upsertSkill — create', () => {
  it('creates a new skill with trimmed fields, enabled by default', () => {
    const { entries, skill, error } = upsertSkill(
      [],
      { name: '  Commit style  ', description: ' short ', body: ' do X ', source: 'user' },
      { now: () => 100, genId: () => 'a' },
    )
    expect(error).toBeUndefined()
    expect(skill).toEqual({
      id: 'a',
      name: 'Commit style',
      description: 'short',
      body: 'do X',
      enabled: true,
      source: 'user',
      createdAt: 100,
      updatedAt: 100,
    })
    expect(entries).toEqual([skill])
  })

  it('rejects an empty name or body', () => {
    expect(upsertSkill([], { name: '', description: '', body: 'x', source: 'user' }).error).toMatch(
      /name/,
    )
    expect(
      upsertSkill([], { name: 'x', description: '', body: '  ', source: 'user' }).error,
    ).toMatch(/body/)
  })

  it('rejects a duplicate name (case-insensitive), leaving entries untouched', () => {
    const first = upsertSkill(
      [],
      { name: 'Deploys', description: '', body: 'x', source: 'user' },
      { genId: () => 'a' },
    )
    const second = upsertSkill(first.entries, {
      name: 'deploys',
      description: '',
      body: 'y',
      source: 'agent',
    })
    expect(second.error).toMatch(/already exists/)
    expect(second.entries).toBe(first.entries)
  })

  it('caps the number of skills', () => {
    let entries: SkillEntry[] = []
    for (let i = 0; i < 3; i++) {
      entries = upsertSkill(
        entries,
        { name: `skill ${i}`, description: '', body: 'x', source: 'user' },
        { maxEntries: 3, genId: () => `id${i}` },
      ).entries
    }
    const result = upsertSkill(
      entries,
      { name: 'one too many', description: '', body: 'x', source: 'user' },
      { maxEntries: 3 },
    )
    expect(result.error).toMatch(/too many/)
    expect(result.entries).toHaveLength(3)
  })

  it('truncates an overlong body instead of storing it whole', () => {
    const { skill } = upsertSkill(
      [],
      { name: 'x', description: '', body: 'y'.repeat(20_000), source: 'user' },
      { genId: () => 'a' },
    )
    expect(skill!.body.length).toBe(8_000)
  })
})

describe('upsertSkill — update by id', () => {
  it('replaces name/description/body and bumps updatedAt, keeping source and id', () => {
    const created = upsertSkill(
      [],
      { name: 'Old name', description: 'old', body: 'old body', source: 'agent' },
      { now: () => 1, genId: () => 'a' },
    )
    const updated = upsertSkill(
      created.entries,
      { name: 'New name', description: 'new', body: 'new body', source: 'agent' },
      { id: 'a', now: () => 2 },
    )
    expect(updated.skill).toEqual({
      id: 'a',
      name: 'New name',
      description: 'new',
      body: 'new body',
      enabled: true,
      source: 'agent',
      createdAt: 1,
      updatedAt: 2,
    })
  })

  it('errors on an unknown id without touching entries', () => {
    const result = upsertSkill(
      [],
      { name: 'x', description: '', body: 'y', source: 'user' },
      { id: 'missing' },
    )
    expect(result.error).toMatch(/no skill/)
  })

  it('allows renaming to the same name it already has', () => {
    const created = upsertSkill(
      [],
      { name: 'Same', description: '', body: 'x', source: 'user' },
      { genId: () => 'a' },
    )
    const updated = upsertSkill(
      created.entries,
      { name: 'Same', description: '', body: 'y', source: 'user' },
      { id: 'a' },
    )
    expect(updated.error).toBeUndefined()
    expect(updated.skill!.body).toBe('y')
  })
})

describe('removeSkill', () => {
  it('removes the matching entry and leaves the rest', () => {
    const a: SkillEntry = {
      id: 'a',
      name: 'A',
      description: '',
      body: 'x',
      enabled: true,
      source: 'user',
      createdAt: 1,
      updatedAt: 1,
    }
    const b = { ...a, id: 'b', name: 'B' }
    expect(removeSkill([a, b], 'a')).toEqual([b])
  })
})

describe('setSkillEnabledPure', () => {
  it('flips enabled and bumps updatedAt for the matching entry only', () => {
    const a: SkillEntry = {
      id: 'a',
      name: 'A',
      description: '',
      body: 'x',
      enabled: true,
      source: 'user',
      createdAt: 1,
      updatedAt: 1,
    }
    const b = { ...a, id: 'b', name: 'B' }
    const result = setSkillEnabledPure([a, b], 'a', false, () => 99)
    expect(result[0]).toEqual({ ...a, enabled: false, updatedAt: 99 })
    expect(result[1]).toEqual(b)
  })
})

describe('renderSkillsForPrompt (INT-02)', () => {
  const make = (over: Partial<SkillEntry>): SkillEntry => ({
    id: over.id ?? 'x',
    name: over.name ?? 'X',
    description: over.description ?? '',
    body: over.body ?? 'body',
    enabled: over.enabled ?? true,
    source: over.source ?? 'user',
    createdAt: over.createdAt ?? 1,
    updatedAt: over.updatedAt ?? 1,
  })

  it('returns an empty string with no entries', () => {
    expect(renderSkillsForPrompt([])).toBe('')
  })

  it('excludes disabled skills', () => {
    const rendered = renderSkillsForPrompt([
      make({ name: 'On', body: 'visible' }),
      make({ id: 'y', name: 'Off', body: 'hidden', enabled: false }),
    ])
    expect(rendered).toContain('visible')
    expect(rendered).not.toContain('hidden')
  })

  it('sorts alphabetically by name regardless of insertion order', () => {
    const rendered = renderSkillsForPrompt([
      make({ id: 'z', name: 'Zebra', body: 'z-body' }),
      make({ id: 'a', name: 'Apple', body: 'a-body' }),
    ])
    expect(rendered.indexOf('Apple')).toBeLessThan(rendered.indexOf('Zebra'))
  })

  it('includes the name, description and body for each enabled skill', () => {
    const rendered = renderSkillsForPrompt([
      make({ name: 'Deploys', description: 'How we ship', body: 'run the deploy script' }),
    ])
    expect(rendered).toContain('### Deploys')
    expect(rendered).toContain('How we ship')
    expect(rendered).toContain('run the deploy script')
  })

  it('stops once the character budget is spent instead of overflowing it', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      make({ id: `id${i}`, name: `skill-${String(i).padStart(2, '0')}`, body: 'x'.repeat(50) }),
    )
    const rendered = renderSkillsForPrompt(entries, 300)
    expect(rendered.length).toBeLessThanOrEqual(300)
    expect(rendered).toContain('skill-00')
    expect(rendered).not.toContain('skill-19')
  })
})
