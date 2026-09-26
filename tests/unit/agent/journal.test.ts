import { describe, expect, it } from 'vitest'
import { applyJournalEvent } from '../../../src/main/agent/journal'
import type { AgentUiEvent, JournalEntry } from '../../../src/shared/events'

const toolUse = (
  toolUseId: string,
  name = 'Read',
  input: unknown = { path: '/x' },
  parentToolUseId: string | null = null,
): AgentUiEvent => ({
  type: 'tool-use',
  messageId: 'm1',
  parentToolUseId,
  block: { type: 'tool_use', toolUseId, name, input },
})

const toolResult = (
  toolUseId: string,
  content = 'ok',
  isError = false,
  durationMs?: number,
): AgentUiEvent => ({
  type: 'tool-result',
  toolUseId,
  result: { content, isError, durationMs },
})

describe('applyJournalEvent', () => {
  it('opens an entry on tool-use', () => {
    const next = applyJournalEvent([], toolUse('t1', 'Read', { path: '/a' }), 500, () => 123)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({
      id: 't1',
      toolUseId: 't1',
      name: 'Read',
      timestamp: 123,
      parentToolUseId: null,
    })
    expect(JSON.parse(next[0]!.input)).toEqual({ path: '/a' })
    expect(next[0]!.result).toBeUndefined()
  })

  it('fills in the matching entry on tool-result', () => {
    const opened = applyJournalEvent([], toolUse('t1'), 500, () => 1)
    const filled = applyJournalEvent(opened, toolResult('t1', 'file body', false, 42), 500, () => 2)
    expect(filled).toHaveLength(1)
    expect(filled[0]!.result).toEqual({ content: 'file body', isError: false, durationMs: 42 })
    // The opened array is untouched (pure function).
    expect(opened[0]!.result).toBeUndefined()
  })

  it('is a no-op (same array reference) for a tool-result with no matching open entry', () => {
    const entries: JournalEntry[] = []
    const next = applyJournalEvent(entries, toolResult('unknown'), 500, () => 1)
    expect(next).toBe(entries)
  })

  it('is a no-op for events unrelated to tool calls', () => {
    const entries: JournalEntry[] = []
    const next = applyJournalEvent(entries, { type: 'state', state: 'running' }, 500, () => 1)
    expect(next).toBe(entries)
  })

  it('does not re-fill an entry that already has a result', () => {
    let entries = applyJournalEvent([], toolUse('t1'), 500, () => 1)
    entries = applyJournalEvent(entries, toolResult('t1', 'first'), 500, () => 2)
    const again = applyJournalEvent(entries, toolResult('t1', 'second'), 500, () => 3)
    expect(again).toBe(entries)
    expect(again[0]!.result?.content).toBe('first')
  })

  it('caps the entry count, dropping the oldest first', () => {
    let entries: JournalEntry[] = []
    for (let i = 0; i < 5; i++) entries = applyJournalEvent(entries, toolUse(`t${i}`), 3, () => i)
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.toolUseId)).toEqual(['t2', 't3', 't4'])
  })

  it('truncates very large inputs and results', () => {
    const big = 'x'.repeat(10_000)
    const opened = applyJournalEvent([], toolUse('t1', 'Bash', { command: big }), 500, () => 1)
    expect(opened[0]!.input.length).toBeLessThan(big.length)
    const filled = applyJournalEvent(opened, toolResult('t1', big), 500, () => 2)
    expect(filled[0]!.result!.content.length).toBeLessThan(big.length)
  })
})
