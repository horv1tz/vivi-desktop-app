import { describe, expect, it } from 'vitest'
import {
  addMemoryEntry,
  removeMemoryEntry,
  renderMemoryForPrompt,
} from '../../../src/main/agent/tools/memory'
import type { MemoryEntry } from '../../../src/shared/events'

describe('addMemoryEntry', () => {
  it('appends a new entry with the given type and a timestamp', () => {
    const { entries, added } = addMemoryEntry(
      [],
      { type: 'fact', text: 'likes tea' },
      { now: () => 100, id: () => 'a' },
    )
    expect(added).toBe(true)
    expect(entries).toEqual([{ id: 'a', type: 'fact', text: 'likes tea', createdAt: 100 }])
  })

  it('trims and collapses whitespace in the text', () => {
    const { entries } = addMemoryEntry(
      [],
      { type: 'fact', text: '  likes   tea  ' },
      { now: () => 1, id: () => 'a' },
    )
    expect(entries[0]!.text).toBe('likes tea')
  })

  it('dedupes an identical type+text pair instead of adding a duplicate', () => {
    const first = addMemoryEntry(
      [],
      { type: 'fact', text: 'likes tea' },
      { now: () => 1, id: () => 'a' },
    )
    const second = addMemoryEntry(
      first.entries,
      { type: 'fact', text: 'likes tea' },
      { now: () => 2, id: () => 'b' },
    )
    expect(second.added).toBe(false)
    expect(second.entries).toBe(first.entries)
  })

  it('allows the same text under a different type', () => {
    const first = addMemoryEntry(
      [],
      { type: 'fact', text: 'Paris' },
      { now: () => 1, id: () => 'a' },
    )
    const second = addMemoryEntry(
      first.entries,
      { type: 'project', text: 'Paris' },
      { now: () => 2, id: () => 'b' },
    )
    expect(second.added).toBe(true)
    expect(second.entries).toHaveLength(2)
  })

  it('caps the entry count, dropping the oldest first', () => {
    let entries: MemoryEntry[] = []
    for (let i = 0; i < 5; i++) {
      entries = addMemoryEntry(
        entries,
        { type: 'fact', text: `fact ${i}` },
        { maxEntries: 3, now: () => i, id: () => `id${i}` },
      ).entries
    }
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.text)).toEqual(['fact 2', 'fact 3', 'fact 4'])
  })
})

describe('removeMemoryEntry', () => {
  it('removes the matching entry and leaves the rest untouched', () => {
    const entries: MemoryEntry[] = [
      { id: 'a', type: 'fact', text: 'x', createdAt: 1 },
      { id: 'b', type: 'fact', text: 'y', createdAt: 2 },
    ]
    expect(removeMemoryEntry(entries, 'a')).toEqual([
      { id: 'b', type: 'fact', text: 'y', createdAt: 2 },
    ])
  })

  it('is a no-op for an unknown id', () => {
    const entries: MemoryEntry[] = [{ id: 'a', type: 'fact', text: 'x', createdAt: 1 }]
    expect(removeMemoryEntry(entries, 'nope')).toEqual(entries)
  })
})

describe('renderMemoryForPrompt (AG-03)', () => {
  it('renders newest first', () => {
    const entries: MemoryEntry[] = [
      { id: 'a', type: 'fact', text: 'old office address', createdAt: 1 },
      { id: 'b', type: 'fact', text: 'new office address', createdAt: 2 },
    ]
    const rendered = renderMemoryForPrompt(entries)
    expect(rendered.indexOf('new office address')).toBeLessThan(
      rendered.indexOf('old office address'),
    )
  })

  it('keeps the newest entries and drops the oldest once the character budget is spent — the opposite of truncating a growing file from the end', () => {
    const entries: MemoryEntry[] = Array.from({ length: 50 }, (_, i) => ({
      id: `id${i}`,
      type: 'fact' as const,
      text: `fact number ${i}`,
      createdAt: i,
    }))
    const rendered = renderMemoryForPrompt(entries, 200)
    expect(rendered).toContain('fact number 49')
    expect(rendered).not.toContain('fact number 0\n')
    expect(rendered.length).toBeLessThanOrEqual(200)
  })

  it('returns an empty string for no entries', () => {
    expect(renderMemoryForPrompt([])).toBe('')
  })
})
