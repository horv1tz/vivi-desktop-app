import { describe, expect, it } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { AcpTranslator, toolNameOf, toolResultOf } from '@main/agent/acp/translate'
import type { AgentUiEvent } from '@shared/events'

function make(now = () => 1000) {
  const events: AgentUiEvent[] = []
  const t = new AcpTranslator({ emit: (e) => events.push(e), now })
  return { t, events }
}

const text = (
  s: string,
  kind:
    'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk' = 'agent_message_chunk',
): SessionUpdate => ({ sessionUpdate: kind, content: { type: 'text', text: s } })

describe('AcpTranslator (live turn)', () => {
  it('streams text deltas into one assistant message and finalizes it on turn end', () => {
    const { t, events } = make()
    t.beginTurn()
    t.handleUpdate(text('Hel'))
    t.handleUpdate(text('lo'))
    t.handleUpdate(text('think', 'agent_thought_chunk'))
    const result = t.finishTurn({
      stopReason: 'end_turn',
      usage: { totalTokens: 30, inputTokens: 10, outputTokens: 20 },
    })
    const types = events.map((e) => e.type)
    expect(types).toEqual([
      'assistant-start',
      'text-delta',
      'text-delta',
      'text-delta',
      'assistant-message',
      'result',
    ])
    const start = events[0] as Extract<AgentUiEvent, { type: 'assistant-start' }>
    const deltas = events.filter(
      (e): e is Extract<AgentUiEvent, { type: 'text-delta' }> => e.type === 'text-delta',
    )
    expect(deltas.every((d) => d.messageId === start.messageId)).toBe(true)
    expect(deltas.map((d) => [d.blockIndex, d.kind, d.text])).toEqual([
      [0, 'text', 'Hel'],
      [0, 'text', 'lo'],
      [1, 'thinking', 'think'],
    ])
    const final = events[4] as Extract<AgentUiEvent, { type: 'assistant-message' }>
    expect(final.message.blocks).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'thinking', text: 'think' },
    ])
    expect(result.subtype).toBe('success')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(20)
    expect(result.resultText).toBe('Hello')
  })

  it('maps tool calls and their completion to tool-use / tool-result, starting a new message after tools', () => {
    let now = 0
    const { t, events } = make(() => now)
    t.beginTurn()
    t.handleUpdate(text('Let me look.'))
    t.handleUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc1',
      title: 'Read file',
      kind: 'read',
      status: 'in_progress',
      rawInput: { file_path: '/x' },
      _meta: { claudeCode: { toolName: 'Read' } },
    })
    now = 250
    t.handleUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'file body' } }],
    })
    t.handleUpdate(text('Done.'))
    t.finishTurn({ stopReason: 'end_turn' })
    const types = events.map((e) => e.type)
    expect(types).toEqual([
      'assistant-start',
      'text-delta',
      'tool-use',
      'tool-result',
      'assistant-message',
      'assistant-start',
      'text-delta',
      'assistant-message',
      'result',
    ])
    const use = events[2] as Extract<AgentUiEvent, { type: 'tool-use' }>
    expect(use.block).toMatchObject({ toolUseId: 'tc1', name: 'Read', input: { file_path: '/x' } })
    const res = events[3] as Extract<AgentUiEvent, { type: 'tool-result' }>
    expect(res.result).toMatchObject({ content: 'file body', isError: false, durationMs: 250 })
    const first = events[4] as Extract<AgentUiEvent, { type: 'assistant-message' }>
    expect(first.message.blocks.map((b) => b.type)).toEqual(['text', 'tool_use'])
    expect((first.message.blocks[1] as { result?: unknown }).result).toMatchObject({
      content: 'file body',
    })
    const second = events[7] as Extract<AgentUiEvent, { type: 'assistant-message' }>
    expect(second.message.id).not.toBe(first.message.id)
    expect(second.message.blocks).toEqual([{ type: 'text', text: 'Done.' }])
  })

  it('emits tool-update when the input arrives after the call was announced', () => {
    const { t, events } = make()
    t.beginTurn()
    t.handleUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'x',
      title: 'Bash',
      status: 'pending',
      rawInput: {},
      _meta: { claudeCode: { toolName: 'Bash' } },
    })
    t.handleUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'x',
      status: 'in_progress',
      rawInput: { command: 'ls' },
    })
    t.handleUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'x',
      status: 'completed',
      rawOutput: 'a',
    })
    expect(events.map((e) => e.type)).toEqual([
      'assistant-start',
      'tool-use',
      'tool-update',
      'tool-result',
    ])
    const upd = events[2] as Extract<AgentUiEvent, { type: 'tool-update' }>
    expect(upd).toMatchObject({ toolUseId: 'x', input: { command: 'ls' }, name: 'Bash' })
  })

  it('marks failed tools as errors and settles unfinished tools when the turn is cancelled', () => {
    const { t, events } = make()
    t.beginTurn()
    t.handleUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'a',
      title: 'Bash',
      status: 'pending',
    })
    t.handleUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'a',
      status: 'failed',
      rawOutput: { error: 'boom' },
    })
    t.handleUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'b',
      title: 'Bash',
      status: 'pending',
    })
    t.finishTurn({ stopReason: 'cancelled' })
    const results = events.filter(
      (e): e is Extract<AgentUiEvent, { type: 'tool-result' }> => e.type === 'tool-result',
    )
    expect(results.map((r) => [r.toolUseId, r.result.isError])).toEqual([
      ['a', true],
      ['b', true],
    ])
    expect(results[0]!.result.content).toContain('boom')
    const result = events.at(-1) as Extract<AgentUiEvent, { type: 'result' }>
    expect(result.result.subtype).toBe('cancelled')
  })

  it('ignores updates for plans/modes and records usage for the context window', () => {
    const { t, events } = make()
    t.beginTurn()
    t.handleUpdate({
      sessionUpdate: 'plan',
      entries: [{ content: 'x', priority: 'medium', status: 'pending' }],
    })
    t.handleUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'default' })
    t.handleUpdate({ sessionUpdate: 'usage_update', used: 1000, size: 200000 })
    const r = t.finishTurn({ stopReason: 'end_turn' })
    expect(events.map((e) => e.type)).toEqual(['result'])
    expect(r.contextWindow).toBe(200000)
  })
})

describe('AcpTranslator (usage and diffs)', () => {
  it('reports the per-prompt usage the agent returns, turn by turn', () => {
    const { t } = make()
    t.beginTurn()
    const r1 = t.finishTurn({
      stopReason: 'end_turn',
      usage: {
        totalTokens: 110,
        inputTokens: 10,
        outputTokens: 100,
        cachedReadTokens: 1000,
        cachedWriteTokens: 0,
      },
    })
    t.beginTurn()
    const r2 = t.finishTurn({
      stopReason: 'end_turn',
      usage: {
        totalTokens: 200,
        inputTokens: 15,
        outputTokens: 185,
        cachedReadTokens: 1500,
        cachedWriteTokens: 20,
      },
    })
    expect([r1.inputTokens, r1.outputTokens, r1.cacheReadTokens]).toEqual([10, 100, 1000])
    expect([r2.inputTokens, r2.outputTokens, r2.cacheReadTokens, r2.cacheWriteTokens]).toEqual([
      15, 185, 1500, 20,
    ])
    t.beginTurn()
    const r3 = t.finishTurn({ stopReason: 'end_turn' })
    expect([r3.inputTokens, r3.outputTokens]).toEqual([0, 0])
  })

  it('leaves cost undefined (never $0.00) until the agent reports usage_update.cost (ACP-01)', () => {
    const { t } = make()
    t.beginTurn()
    const r1 = t.finishTurn({ stopReason: 'end_turn' })
    expect(r1.costUsd).toBeUndefined()
    expect(r1.totalCostUsd).toBeUndefined()
  })

  it('derives per-turn cost as the delta of the cumulative session cost (ACP-01)', () => {
    const { t } = make()
    t.beginTurn()
    t.handleUpdate({
      sessionUpdate: 'usage_update',
      used: 100,
      size: 200000,
      cost: { amount: 0.02, currency: 'USD' },
    })
    const r1 = t.finishTurn({ stopReason: 'end_turn' })
    expect(r1.costUsd).toBeCloseTo(0.02)
    expect(r1.totalCostUsd).toBeCloseTo(0.02)
    t.beginTurn()
    t.handleUpdate({
      sessionUpdate: 'usage_update',
      used: 300,
      size: 200000,
      cost: { amount: 0.05, currency: 'USD' },
    })
    const r2 = t.finishTurn({ stopReason: 'end_turn' })
    expect(r2.costUsd).toBeCloseTo(0.03)
    expect(r2.totalCostUsd).toBeCloseTo(0.05)
    // A turn with no fresh usage_update keeps reporting the last known total, with zero delta.
    t.beginTurn()
    const r3 = t.finishTurn({ stopReason: 'end_turn' })
    expect(r3.costUsd).toBeCloseTo(0)
    expect(r3.totalCostUsd).toBeCloseTo(0.05)
  })

  it('ignores a reported cost in a non-USD currency', () => {
    const { t } = make()
    t.beginTurn()
    t.handleUpdate({
      sessionUpdate: 'usage_update',
      used: 100,
      size: 200000,
      cost: { amount: 0.02, currency: 'EUR' },
    })
    const r1 = t.finishTurn({ stopReason: 'end_turn' })
    expect(r1.costUsd).toBeUndefined()
    expect(r1.totalCostUsd).toBeUndefined()
  })

  it('keeps the diff announced with an Edit call when the completion update carries no content', () => {
    const { t, events } = make()
    t.beginTurn()
    t.handleUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'e1',
      title: 'Edit file',
      kind: 'edit',
      status: 'pending',
      content: [{ type: 'diff', path: '/f.txt', oldText: 'a', newText: 'b' }],
    })
    t.handleUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'e1', status: 'completed' })
    const res = events.find(
      (e): e is Extract<AgentUiEvent, { type: 'tool-result' }> => e.type === 'tool-result',
    )!
    expect(res.result.content).toContain('--- /f.txt')
    expect(res.result.content).toContain('+ b')
  })

  it('does not synthesize results for replayed tool calls in the next live turn', () => {
    const { t, events } = make()
    t.beginReplay()
    t.handleUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'old',
      title: 'Bash',
      status: 'in_progress',
    })
    t.endReplay()
    t.beginTurn()
    t.finishTurn({ stopReason: 'end_turn' })
    expect(events.filter((e) => e.type === 'tool-result')).toEqual([])
  })
})

describe('AcpTranslator (replay)', () => {
  it('rebuilds the conversation from a session/load replay without emitting live events', () => {
    const { t, events } = make()
    t.beginReplay()
    t.handleUpdate(text('hi there', 'user_message_chunk'))
    t.handleUpdate(text('Hello! ', 'agent_message_chunk'))
    t.handleUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc',
      title: 'Glob',
      status: 'completed',
      rawInput: { pattern: '*' },
      content: [{ type: 'content', content: { type: 'text', text: 'a.txt' } }],
    })
    t.handleUpdate(text('Found one file.', 'agent_message_chunk'))
    t.handleUpdate(text('thanks', 'user_message_chunk'))
    const history = t.endReplay()
    expect(events).toEqual([])
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant', 'user'])
    expect(history[0]!.blocks).toEqual([{ type: 'text', text: 'hi there' }])
    expect(history[1]!.blocks.map((b) => b.type)).toEqual(['text', 'tool_use'])
    expect((history[1]!.blocks[1] as { result?: { content: string } }).result?.content).toBe(
      'a.txt',
    )
    expect(history[2]!.blocks).toEqual([{ type: 'text', text: 'Found one file.' }])
  })
})

describe('helpers', () => {
  it('derives tool names from Claude meta, then name/title/kind', () => {
    expect(toolNameOf({ title: 'Read file', _meta: { claudeCode: { toolName: 'Read' } } })).toBe(
      'Read',
    )
    expect(toolNameOf({ title: 'Search', name: 'grep' })).toBe('grep')
    expect(toolNameOf({ title: 'Search' })).toBe('Search')
    expect(toolNameOf({ kind: 'execute' })).toBe('execute')
  })

  it('renders diffs, images and raw output in tool results', () => {
    const r = toolResultOf({
      toolCallId: 'x',
      status: 'completed',
      content: [
        { type: 'diff', path: '/f', oldText: 'a', newText: 'b' },
        { type: 'content', content: { type: 'image', data: 'AAA', mimeType: 'image/png' } },
      ],
    })
    expect(r.content).toContain('--- /f')
    expect(r.content).toContain('- a')
    expect(r.content).toContain('+ b')
    expect(r.images).toEqual([{ type: 'image', mimeType: 'image/png', data: 'AAA' }])
    expect(toolResultOf({ toolCallId: 'y', status: 'completed', rawOutput: 'plain' }).content).toBe(
      'plain',
    )
  })
})
