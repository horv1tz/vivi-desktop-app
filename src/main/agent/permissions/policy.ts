import type { PermissionRule, PermissionSettings } from '@shared/settings'
import type { PermissionCategory } from '@shared/events'
import type { PolicyDecision } from './broker'
import { detectDangerousCommand } from './danger'

export const READ_ONLY_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'ToolSearch',
  'LSP',
  'mcp__vivi__list_windows',
  'mcp__vivi__system_info',
  'mcp__vivi__remember',
  'mcp__vivi__speak',
  'mcp__vivi__stop_speaking',
  'mcp__vivi__notify',
  'mcp__vivi__list_skills',
]
/** Privacy-sensitive read-only tools with their own toggle, separate from the blanket autoAllowReadOnly. */
export const SCREEN_TOOLS = ['mcp__vivi__screenshot']
export const CLIPBOARD_READ_TOOLS = ['mcp__vivi__clipboard_read']
export const EDIT_TOOLS = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'mcp__vivi__clipboard_write',
  'mcp__vivi__manage_skill',
]
export const EXEC_TOOLS = ['Bash', 'PowerShell', 'mcp__vivi__open', 'Agent', 'Skill']
export const INPUT_TOOLS = ['mcp__vivi__mouse', 'mcp__vivi__keyboard', 'mcp__vivi__windows']
export const SYSTEM_TOOLS = ['mcp__vivi__system']

export function categorize(toolName: string): PermissionCategory {
  if (
    READ_ONLY_TOOLS.includes(toolName) ||
    SCREEN_TOOLS.includes(toolName) ||
    CLIPBOARD_READ_TOOLS.includes(toolName)
  )
    return 'read'
  if (EDIT_TOOLS.includes(toolName)) return 'edit'
  if (EXEC_TOOLS.includes(toolName)) return 'exec'
  if (INPUT_TOOLS.includes(toolName)) return 'input'
  if (SYSTEM_TOOLS.includes(toolName)) return 'system'
  return 'unknown'
}

/** Tools that never need a prompt given the current settings (passed as allowedTools to the SDK). */
export function autoAllowedTools(settings: PermissionSettings): string[] {
  const out = new Set<string>()
  if (settings.autoAllowReadOnly) for (const t of READ_ONLY_TOOLS) out.add(t)
  if (settings.autoAllowScreenshot) for (const t of SCREEN_TOOLS) out.add(t)
  if (settings.autoAllowClipboardRead) for (const t of CLIPBOARD_READ_TOOLS) out.add(t)
  if (!settings.askForEdits) for (const t of EDIT_TOOLS) out.add(t)
  if (!settings.askForSystem) for (const t of SYSTEM_TOOLS) out.add(t)
  // Agent (subagents) and TodoWrite are harmless by themselves; their tools are checked individually.
  out.add('Agent')
  out.add('TodoWrite')
  return [...out]
}

/**
 * Whether a persisted "always allow" rule covers this call. A bare rule (no ruleContent) always
 * allows the tool; a scoped rule matches a command prefix ("git:*") or a fetched host ("domain:x").
 * This is what makes "always allow" actually stick on the next call for any backend — the SDK/Claude
 * CLI additionally enforces the same rules itself, but a non-Claude ACP agent has no such layer, so
 * Vivi's own policy must honor them too.
 */
export function matchesAlwaysAllowRule(
  toolName: string,
  input: Record<string, unknown>,
  rules: PermissionRule[],
): boolean {
  for (const r of rules) {
    if (r.toolName !== toolName) continue
    if (!r.ruleContent) return true
    const prefix = /^([\w./-]+):\*$/.exec(r.ruleContent)
    if (prefix && typeof input.command === 'string') {
      if (input.command.trim().split(/\s+/)[0] === prefix[1]) return true
      continue
    }
    const domain = /^domain:(.+)$/.exec(r.ruleContent)
    if (domain && typeof input.url === 'string') {
      try {
        if (new URL(input.url).hostname === domain[1]) return true
      } catch {
        /* not a URL: no match */
      }
    }
  }
  return false
}

export interface PolicyState {
  /** Categories granted for the live session via "allow for this session". */
  sessionGrants: Set<PermissionCategory>
  /** Categories granted for the current turn (a plain "allow" on computer-control tools). */
  turnGrants: Set<PermissionCategory>
}

export function makePolicy(getSettings: () => PermissionSettings, state: PolicyState) {
  return (toolName: string, input: Record<string, unknown>): PolicyDecision => {
    const settings = getSettings()
    const category = categorize(toolName)
    const danger = detectDangerousCommand(toolName, input)
    const base: PolicyDecision = {
      verdict: 'ask',
      category,
      dangerous: danger.dangerous,
      dangerReasons: danger.reasons,
      canAlwaysAllow: !danger.dangerous,
    }
    if (danger.dangerous) return base
    if (SCREEN_TOOLS.includes(toolName))
      return settings.autoAllowScreenshot ? { ...base, verdict: 'allow' } : base
    if (CLIPBOARD_READ_TOOLS.includes(toolName))
      return settings.autoAllowClipboardRead ? { ...base, verdict: 'allow' } : base
    if (category === 'read' && settings.autoAllowReadOnly) return { ...base, verdict: 'allow' }
    if (category === 'edit' && !settings.askForEdits) return { ...base, verdict: 'allow' }
    if (category === 'exec' && !settings.askForExec) return { ...base, verdict: 'allow' }
    if (category === 'system' && !settings.askForSystem) return { ...base, verdict: 'allow' }
    if (
      category === 'input' &&
      (!settings.askForInput || state.sessionGrants.has('input') || state.turnGrants.has('input'))
    )
      return { ...base, verdict: 'allow' }
    if (state.sessionGrants.has(category)) return { ...base, verdict: 'allow' }
    if (matchesAlwaysAllowRule(toolName, input, settings.alwaysAllowRules))
      return { ...base, verdict: 'allow' }
    return base
  }
}
