import { describe, expect, it } from 'vitest'
import { dangerConfirmationHook } from '../../../src/main/agent/permissions/danger-hook'
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'

const base = { session_id: 's', transcript_path: '/t', cwd: '/', hook_event_name: 'PreToolUse' as const, tool_use_id: 'tu1' }

function input(toolName: string, toolInput: unknown): PreToolUseHookInput {
  return { ...base, tool_name: toolName, tool_input: toolInput }
}

describe('dangerConfirmationHook', () => {
  it('forces an ask decision for a dangerous command regardless of session bypass', async () => {
    const out = await dangerConfirmationHook(input('Bash', { command: 'rm -rf /' }), 'tu1', { signal: new AbortController().signal })
    expect(out).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } })
    expect((out as { hookSpecificOutput?: { permissionDecisionReason?: string } }).hookSpecificOutput?.permissionDecisionReason).toMatch(/dangerous/i)
  })

  it('does not intervene for a safe command', async () => {
    const out = await dangerConfirmationHook(input('Bash', { command: 'ls -la' }), 'tu1', { signal: new AbortController().signal })
    expect(out).toEqual({})
  })

  it('ignores non-PreToolUse hook events', async () => {
    const notify = { session_id: 's', transcript_path: '/t', cwd: '/', hook_event_name: 'Notification' as const, message: 'hi' }
    const out = await dangerConfirmationHook(notify as never, undefined, { signal: new AbortController().signal })
    expect(out).toEqual({})
  })
})
