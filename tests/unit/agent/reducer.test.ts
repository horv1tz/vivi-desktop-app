import { describe, expect, it, vi } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { SessionReducer, historyToUi, mapErrorCode } from '../../../src/main/agent/reducer'
import type { AgentUiEvent } from '../../../src/shared/events'

const sid = 'sess-1'
const base = { session_id: sid, uuid: 'u' as never }

function init(): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sid,
    uuid: 'u1',
    apiKeySource: 'none',
    claude_code_version: '2.1.283',
    cwd: '/tmp',
    tools: ['Read', 'Bash'],
    mcp_servers: [],
    model: 'claude-opus-5',
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
  } as unknown as SDKMessage
}

function streamEvent(event: Record<string, unknown>, parent: string | null = null): SDKMessage {
  return {
    type: 'stream_event',
    event,
    parent_tool_use_id: parent,
    ...base,
  } as unknown as SDKMessage
}

describe('SessionReducer', () => {
  it('emits session on init and coalesces text deltas', () => {
    const events: AgentUiEvent[] = []
    const r = new SessionReducer({ emit: (e) => events.push(e), flushMs: 1000 })
    r.handle(init())
    expect(events[0]).toMatchObject({ type: 'session', sessionId: sid, model: 'claude-opus-5' })
    r.handle(streamEvent({ type: 'message_start' }))
    r.handle(
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hel' },
      }),
    )
    r.handle(
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'lo' },
      }),
    )
    expect(events.filter((e) => e.type === 'text-delta')).toHaveLength(0)
    r.flush()
    const deltas = events.filter((e) => e.type === 'text-delta')
    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toMatchObject({ text: 'Hello', blockIndex: 0, kind: 'text' })
    const start = events.find((e) => e.type === 'assistant-start')
    expect(start).toBeTruthy()
  })

  it('replaces the streamed message with the final assistant message and emits tool-use', () => {
    const events: AgentUiEvent[] = []
    const r = new SessionReducer({ emit: (e) => events.push(e), flushMs: 1000 })
    r.handle(init())
    r.handle(streamEvent({ type: 'message_start' }))
    r.handle(
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Look' },
      }),
    )
    const startId = (events.find((e) => e.type === 'assistant-start') as { messageId: string })
      .messageId
    r.handle({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'm',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } },
        ],
      },
      ...base,
    } as unknown as SDKMessage)
    const final = events.find((e) => e.type === 'assistant-message') as Extract<
      AgentUiEvent,
      { type: 'assistant-message' }
    >
    expect(final.message.id).toBe(startId)
    expect(final.message.blocks).toHaveLength(2)
    expect(events.find((e) => e.type === 'tool-use')).toMatchObject({
      block: { toolUseId: 't1', name: 'Read' },
    })
    r.handle({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'file body', is_error: false },
        ],
      },
      ...base,
    } as unknown as SDKMessage)
    expect(events.find((e) => e.type === 'tool-result')).toMatchObject({
      toolUseId: 't1',
      result: { content: 'file body', isError: false },
    })
  })

  it('computes per-turn cost from cumulative totals and maps error subtypes', () => {
    const events: AgentUiEvent[] = []
    const r = new SessionReducer({ emit: (e) => events.push(e) })
    const result = (total: number, subtype = 'success'): SDKMessage =>
      ({
        type: 'result',
        subtype,
        is_error: subtype !== 'success',
        duration_ms: 10,
        duration_api_ms: 5,
        num_turns: 1,
        result: 'ok',
        stop_reason: 'end_turn',
        total_cost_usd: total,
        usage: { input_tokens: 10, output_tokens: 5 },
        modelUsage: { m: { contextWindow: 200000 } },
        permission_denials: [],
        errors: subtype === 'success' ? undefined : ['boom'],
        ...base,
      }) as unknown as SDKMessage
    r.handle(result(0.5))
    r.handle(result(0.8))
    const results = events.filter((e) => e.type === 'result') as Extract<
      AgentUiEvent,
      { type: 'result' }
    >[]
    expect(results[0]!.result.costUsd).toBeCloseTo(0.5)
    expect(results[1]!.result.costUsd).toBeCloseTo(0.3)
    expect(results[1]!.result.contextWindow).toBe(200000)
    r.handle(result(0.8, 'error_max_turns'))
    expect(events.filter((e) => e.type === 'error').at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'max_turns' },
    })
  })

  it('maps session state changes and rate limits', () => {
    const events: AgentUiEvent[] = []
    const r = new SessionReducer({ emit: (e) => events.push(e) })
    r.handle({
      type: 'system',
      subtype: 'session_state_changed',
      state: 'running',
      ...base,
    } as unknown as SDKMessage)
    r.handle({
      type: 'system',
      subtype: 'session_state_changed',
      state: 'requires_action',
      ...base,
    } as unknown as SDKMessage)
    r.handle({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed_warning',
        rateLimitType: 'seven_day',
        utilization: 0.8,
        resetsAt: 1,
      },
      ...base,
    } as unknown as SDKMessage)
    expect(events.map((e) => e.type)).toEqual(['state', 'state', 'rate-limit'])
    expect(events[1]).toMatchObject({ state: 'awaiting_permission' })
  })

  it('maps sdk error strings', () => {
    expect(mapErrorCode('authentication_failed')).toBe('authentication_failed')
    expect(mapErrorCode('weird')).toBe('unknown')
  })

  it('flushes deltas on a timer', async () => {
    vi.useFakeTimers()
    const events: AgentUiEvent[] = []
    const r = new SessionReducer({ emit: (e) => events.push(e), flushMs: 20 })
    r.handle(streamEvent({ type: 'message_start' }))
    r.handle(
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'x' },
      }),
    )
    vi.advanceTimersByTime(25)
    expect(events.some((e) => e.type === 'text-delta')).toBe(true)
    vi.useRealTimers()
  })
})

describe('historyToUi', () => {
  it('rebuilds messages and attaches tool results to tool blocks', () => {
    const ui = historyToUi([
      {
        type: 'user',
        uuid: 'a',
        parent_tool_use_id: null,
        message: { role: 'user', content: 'hi' },
      },
      {
        type: 'assistant',
        uuid: 'b',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } }],
        },
      },
      {
        type: 'user',
        uuid: 'c',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: 'out' }] },
          ],
        },
      },
      {
        type: 'assistant',
        uuid: 'd',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      },
    ])
    expect(ui).toHaveLength(3)
    expect(ui[0]).toMatchObject({ role: 'user', blocks: [{ type: 'text', text: 'hi' }] })
    const tool = ui[1]!.blocks[0]
    expect(tool).toMatchObject({ type: 'tool_use', result: { content: 'out' } })
  })
})
