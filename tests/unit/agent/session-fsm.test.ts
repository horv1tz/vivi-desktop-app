import { describe, expect, it } from 'vitest'
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AgentSession, type QueryFn } from '../../../src/main/agent/session'
import type { AgentUiEvent } from '../../../src/shared/events'

const initMsg: SDKMessage = { type: 'system', subtype: 'init', session_id: 's', uuid: 'u', apiKeySource: 'none', claude_code_version: 'x', cwd: '/', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], output_style: 'd', skills: [], plugins: [] } as unknown as SDKMessage

function fakeQuery(script: (input: AsyncIterable<SDKUserMessage>, emit: (m: SDKMessage) => void) => Promise<void>, opts: { throwAtEnd?: string } = {}): { queryFn: QueryFn; interrupted: () => boolean } {
  let interrupted = false
  const queryFn: QueryFn = ({ prompt }) => {
    const buffer: SDKMessage[] = []
    let waiter: ((v: IteratorResult<SDKMessage>) => void) | null = null
    let done = false
    let error: Error | null = null
    const emit = (m: SDKMessage): void => {
      if (waiter) {
        const w = waiter
        waiter = null
        w({ value: m, done: false })
      } else buffer.push(m)
    }
    void script(prompt, emit)
      .catch((e: unknown) => {
        error = e instanceof Error ? e : new Error(String(e))
      })
      .finally(() => {
        if (opts.throwAtEnd) error = new Error(opts.throwAtEnd)
        done = true
        if (waiter) {
          const w = waiter
          waiter = null
          if (error) w(Promise.reject(error) as never)
          else w({ value: undefined as never, done: true })
        }
      })
    const gen = {
      next: async (): Promise<IteratorResult<SDKMessage>> => {
        const m = buffer.shift()
        if (m) return { value: m, done: false }
        if (done) {
          if (error) throw error
          return { value: undefined as never, done: true }
        }
        return new Promise((resolve, reject) => {
          waiter = (v) => (v instanceof Promise ? v.catch(reject) : resolve(v))
        })
      },
      return: async () => ({ value: undefined as never, done: true as const }),
      throw: async (e: unknown) => {
        throw e
      },
      [Symbol.asyncIterator]() {
        return this
      },
      initializationResult: async () => ({}) as never,
      interrupt: async () => {
        interrupted = true
        return undefined
      },
      close: () => undefined,
      setModel: async () => undefined,
      setPermissionMode: async () => undefined,
      supportedModels: async () => [],
      accountInfo: async () => ({}),
    }
    return gen as unknown as Query
  }
  return { queryFn, interrupted: () => interrupted }
}

describe('AgentSession FSM', () => {
  it('goes starting → idle on init, running on send, idle after result, closed on dispose', async () => {
    const events: AgentUiEvent[] = []
    const { queryFn } = fakeQuery(async (input, emit) => {
      emit(initMsg)
      for await (const msg of input) {
        emit({ type: 'system', subtype: 'session_state_changed', state: 'running', session_id: 's', uuid: 'u' } as unknown as SDKMessage)
        const text = typeof msg.message.content === 'string' ? msg.message.content : 'x'
        emit({ type: 'assistant', parent_tool_use_id: null, session_id: 's', uuid: 'a', message: { role: 'assistant', content: [{ type: 'text', text: `echo ${text}` }] } } as unknown as SDKMessage)
        emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1, result: 'ok', stop_reason: 'end_turn', total_cost_usd: 0.01, usage: {}, modelUsage: {}, permission_denials: [], session_id: 's', uuid: 'r' } as unknown as SDKMessage)
      }
    })
    const session = new AgentSession({ options: {}, queryFn, emit: (e) => events.push(e) })
    expect(session.state).toBe('starting')
    await session.start()
    expect(session.state).toBe('idle')
    await session.send({ text: 'hi' })
    await new Promise((r) => setTimeout(r, 20))
    expect(events.some((e) => e.type === 'user-message')).toBe(true)
    expect(events.some((e) => e.type === 'assistant-message')).toBe(true)
    expect(session.state).toBe('idle')
    await session.dispose()
    expect(session.state).toBe('closed')
    expect(session.isAlive).toBe(false)
  })

  it('reports process_exited and fails when the stream throws', async () => {
    const events: AgentUiEvent[] = []
    const { queryFn } = fakeQuery(async (_input, emit) => {
      emit(initMsg)
      throw new Error('Claude Code process exited with code 1')
    })
    const session = new AgentSession({ options: {}, queryFn, emit: (e) => events.push(e) })
    await session.start().catch(() => undefined)
    await new Promise((r) => setTimeout(r, 20))
    expect(session.state).toBe('failed')
    expect(events.find((e) => e.type === 'error')).toMatchObject({ error: { code: 'process_exited' } })
    await expect(session.send({ text: 'x' })).rejects.toThrow()
  })

  it('times out when init never completes', async () => {
    const events: AgentUiEvent[] = []
    const { queryFn } = fakeQuery(async (input) => {
      for await (const _m of input) {
        /* never emits init */
      }
    })
    const q: QueryFn = (p) => {
      const g = queryFn(p)
      ;(g as unknown as { initializationResult: () => Promise<never> }).initializationResult = () => new Promise(() => undefined)
      return g
    }
    const session = new AgentSession({ options: {}, queryFn: q, emit: (e) => events.push(e), initTimeoutMs: 30 })
    await expect(session.start()).rejects.toThrow(/timeout/)
    expect(events.find((e) => e.type === 'error')).toMatchObject({ error: { code: 'startup_failed' } })
  })

  it('forwards interrupt to the query', async () => {
    const { queryFn, interrupted } = fakeQuery(async (input, emit) => {
      emit(initMsg)
      for await (const _m of input) {
        /* keep alive */
      }
    })
    const session = new AgentSession({ options: {}, queryFn, emit: () => undefined })
    await session.start()
    await session.interrupt()
    expect(interrupted()).toBe(true)
    await session.dispose()
  })
})
