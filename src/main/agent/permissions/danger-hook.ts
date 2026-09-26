import type { HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import { detectDangerousCommand } from './danger'

/**
 * PreToolUse hook that forces a dangerous action through the interactive canUseTool flow even when
 * the session runs with `allowDangerouslySkipPermissions` (permissionMode `bypassPermissions`).
 *
 * The SDK applies the bypass shortcut *before* invoking `canUseTool`, so `bypassPermissions` would
 * otherwise let destructive commands (rm -rf, shutdown, force-push, …) run with zero confirmation —
 * the one guarantee the app makes regardless of mode. Hooks run earlier in the pipeline than that
 * shortcut, and `permissionDecision: 'ask'` routes the call back into `canUseTool` (our permission
 * broker/UI) no matter what the session's bypass flag says. Only ACTUALLY dangerous calls are
 * touched — everything else returns an empty decision and falls through to the session's own mode.
 */
export const dangerConfirmationHook: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return {}
  const { tool_name: toolName, tool_input } = input as PreToolUseHookInput
  const danger = detectDangerousCommand(toolName, (tool_input ?? {}) as Record<string, unknown>)
  if (!danger.dangerous) return {}
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `Vivi: potentially dangerous action (${danger.reasons.join('; ')}) — confirmation is required even in "no permissions" mode.`,
    },
  }
}
