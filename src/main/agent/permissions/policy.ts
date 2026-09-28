import { homedir } from 'node:os'
import { sep } from 'node:path'
import type { PermissionRule, PermissionSettings } from '@shared/settings'
import type { PermissionCategory } from '@shared/events'
import { globToRegExp, parseRuleContent } from '@shared/permissionRules'
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
  'mcp__vivi__list_scenarios',
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
export const INPUT_TOOLS = [
  'mcp__vivi__mouse',
  'mcp__vivi__keyboard',
  'mcp__vivi__windows',
  // WORK-02: a scenario can type/press keys via its own steps, same risk tier as keyboard directly.
  'mcp__vivi__run_scenario',
]
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

/** SEC-03: which input field holds the filesystem path for tools a path-scoped rule can apply to. Tried in order — mirrors renderer/features/chat/ToolCard.tsx's existing fallback chain for the same tools, so a path rule matches exactly what the UI already shows as "the path" for that call. */
const PATH_ARG_TOOLS: Record<string, string[]> = {
  Read: ['file_path', 'path'],
  Write: ['file_path', 'path'],
  Edit: ['file_path', 'path'],
  MultiEdit: ['file_path', 'path'],
  NotebookEdit: ['notebook_path', 'file_path', 'path'],
}

function extractPathArg(toolName: string, input: Record<string, unknown>): string | undefined {
  for (const key of PATH_ARG_TOOLS[toolName] ?? []) {
    const v = input[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

/** Expands a leading `~` the same way a shell would — rule globs and trusted folders are typed by hand, almost always as `~/...`. */
function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? homedir() + p.slice(1) : p
}

function normalizeSlashes(p: string): string {
  return p.split(sep).join('/')
}

/** Whether `path` is `folder` itself or falls under it (`/a/b` is under `/a`, not under `/ab`). */
export function isUnderTrustedFolder(path: string, trustedFolders: string[]): boolean {
  const target = normalizeSlashes(expandHome(path))
  return trustedFolders.some((f) => {
    const folder = normalizeSlashes(expandHome(f)).replace(/\/+$/, '')
    return target === folder || target.startsWith(`${folder}/`)
  })
}

/**
 * Whether one persisted rule (allow OR deny — the caller decides which list to check) covers this
 * call. A bare rule (no ruleContent) matches the tool unconditionally; a scoped rule matches a
 * command prefix ("git:*"), a fetched host ("domain:x"), or a filesystem path glob ("path:~/Vivi/**").
 * This is what makes a rule actually stick on the next call for any backend — the SDK/Claude CLI
 * additionally enforces its own allow-list, but a non-Claude ACP agent has no such layer, so Vivi's
 * own policy must honor rules itself regardless of backend (and is the only place a deny rule is
 * enforced at all, since the CLI's own list has no deny concept — see options.ts).
 */
export function matchesRule(
  toolName: string,
  input: Record<string, unknown>,
  rule: Pick<PermissionRule, 'toolName' | 'ruleContent'>,
): boolean {
  if (rule.toolName !== toolName) return false
  const scope = parseRuleContent(rule.ruleContent)
  switch (scope.kind) {
    case 'bare':
      return true
    case 'prefix':
      return (
        typeof input.command === 'string' && input.command.trim().split(/\s+/)[0] === scope.prefix
      )
    case 'domain':
      if (typeof input.url !== 'string') return false
      try {
        return new URL(input.url).hostname === scope.domain
      } catch {
        return false
      }
    case 'path': {
      const path = extractPathArg(toolName, input)
      if (!path) return false
      return globToRegExp(normalizeSlashes(expandHome(scope.glob))).test(
        normalizeSlashes(expandHome(path)),
      )
    }
  }
}

function matchesAnyRule(
  toolName: string,
  input: Record<string, unknown>,
  rules: PermissionRule[],
  behavior: 'allow' | 'deny',
): boolean {
  return rules.some((r) => r.behavior === behavior && matchesRule(toolName, input, r))
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
    const base: PolicyDecision = {
      verdict: 'ask',
      category,
      dangerous: false,
      dangerReasons: [],
      canAlwaysAllow: true,
    }
    // SEC-03: an explicit user deny wins over everything, including a matching allow rule, an
    // auto-allow category setting, and — deliberately — even the built-in danger detector's
    // "always ask" floor: a deny is strictly safer than an ask (it can't be accidentally approved),
    // so a user who has already said "never" for this shouldn't be asked again.
    if (matchesAnyRule(toolName, input, settings.alwaysAllowRules, 'deny'))
      return {
        ...base,
        verdict: 'deny',
        canAlwaysAllow: false,
        reason: 'deny-rule',
        denyMessage: `Blocked by a "deny" permission rule set in Settings for ${toolName}.`,
      }

    const danger = detectDangerousCommand(toolName, input)
    if (danger.dangerous)
      return { ...base, dangerous: true, dangerReasons: danger.reasons, canAlwaysAllow: false }

    if (SCREEN_TOOLS.includes(toolName))
      return settings.autoAllowScreenshot
        ? { ...base, verdict: 'allow', reason: 'auto-category' }
        : base
    if (CLIPBOARD_READ_TOOLS.includes(toolName))
      return settings.autoAllowClipboardRead
        ? { ...base, verdict: 'allow', reason: 'auto-category' }
        : base
    if (category === 'read' && settings.autoAllowReadOnly)
      return { ...base, verdict: 'allow', reason: 'auto-category' }
    if (category === 'edit' && !settings.askForEdits)
      return { ...base, verdict: 'allow', reason: 'auto-category' }
    if (category === 'exec' && !settings.askForExec)
      return { ...base, verdict: 'allow', reason: 'auto-category' }
    if (category === 'system' && !settings.askForSystem)
      return { ...base, verdict: 'allow', reason: 'auto-category' }
    if (category === 'input') {
      if (!settings.askForInput) return { ...base, verdict: 'allow', reason: 'auto-category' }
      if (state.turnGrants.has('input')) return { ...base, verdict: 'allow', reason: 'turn-grant' }
      if (state.sessionGrants.has('input'))
        return { ...base, verdict: 'allow', reason: 'session-grant' }
    }
    if (state.sessionGrants.has(category))
      return { ...base, verdict: 'allow', reason: 'session-grant' }
    // SEC-03: a folder the user marked trusted skips the ask for edits under it specifically,
    // without needing a per-tool rule — a friendlier grant than "stop asking for edits everywhere".
    if (category === 'edit') {
      const path = extractPathArg(toolName, input)
      if (path && isUnderTrustedFolder(path, settings.trustedFolders))
        return { ...base, verdict: 'allow', reason: 'trusted-folder' }
    }
    if (matchesAnyRule(toolName, input, settings.alwaysAllowRules, 'allow'))
      return { ...base, verdict: 'allow', reason: 'allow-rule' }
    return base
  }
}
