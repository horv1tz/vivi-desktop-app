import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY, type CanUseTool, type McpServerConfig, type Options } from '@anthropic-ai/claude-agent-sdk'
import type { Settings } from '@shared/settings'
import { buildSystemPrompt, osVersionString } from './prompt'
import { dangerConfirmationHook } from './permissions/danger-hook'

export interface BuildOptionsInput {
  settings: Settings
  cwd: string
  homeDir: string
  memoryFile: string
  claudeConfigDir: string
  /** Auth + proxy env pieces (ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, HTTPS_PROXY, …). */
  extraEnv: Record<string, string | undefined>
  /** Explicit CLI path in packaged builds; undefined lets the SDK resolve its bundled binary. */
  claudeBinary?: string
  appVersion: string
  allowedTools: string[]
  disallowedTools?: string[]
  alwaysAllowRules: { toolName: string; ruleContent?: string }[]
  mcpServers?: Record<string, McpServerConfig>
  canUseTool?: CanUseTool
  hooks?: Options['hooks']
  stderr?: (line: string) => void
  abortController?: AbortController
  resume?: string
  voiceMode?: boolean
  baseEnv?: NodeJS.ProcessEnv
  /** Isolate from ~/.claude when true (default); false = reuse the user's own Claude Code config (existing login mode). */
  isolateConfig?: boolean
  debugFile?: string
}

/** Env vars that would make the child believe it runs nested inside another Claude Code session. */
const NESTED_SESSION_VARS = ['CLAUDE_SESSION_ID', 'CLAUDECODE', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SIMPLE', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CODE_REMOTE', 'CLAUDE_CODE_TMPDIR']

export function buildEnv(input: Pick<BuildOptionsInput, 'extraEnv' | 'claudeConfigDir' | 'appVersion' | 'baseEnv' | 'isolateConfig'>): Record<string, string | undefined> {
  const base = { ...(input.baseEnv ?? process.env) }
  for (const k of NESTED_SESSION_VARS) delete base[k]
  const env: Record<string, string | undefined> = {
    ...base,
    CLAUDE_AGENT_SDK_CLIENT_APP: `vivi/${input.appVersion}`,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: base.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ?? '1',
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
  }
  if (input.isolateConfig !== false) env.CLAUDE_CONFIG_DIR = input.claudeConfigDir
  for (const [k, v] of Object.entries(input.extraEnv)) {
    if (v === undefined || v === '') delete env[k]
    else env[k] = v
  }
  return env
}

export function buildPermissionAllowRules(rules: { toolName: string; ruleContent?: string }[]): string[] {
  return rules.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName))
}

export function buildOptions(input: BuildOptionsInput): Options {
  const s = input.settings
  const { staticPart, dynamicPart } = buildSystemPrompt({
    platform: process.platform,
    osVersion: osVersionString(),
    locale: s.appearance.language,
    workspaceDir: input.cwd,
    homeDir: input.homeDir,
    memoryFile: input.memoryFile,
    customInstructions: s.agent.customInstructions,
    voiceMode: input.voiceMode,
  })

  const options: Options = {
    cwd: input.cwd,
    // Deliberately NOT auto-including homeDir: with acceptEdits/auto skipping the edit-category ask
    // entirely, an always-accessible $HOME would let edits land anywhere under it unconfirmed. Users
    // opt in to extra folders explicitly (Settings → Agent → additional directories).
    additionalDirectories: [...new Set(s.agent.additionalDirectories)],
    env: buildEnv(input),
    systemPrompt: { type: 'custom', prompt: [staticPart, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, dynamicPart], snapshot: true },
    tools: { type: 'preset', preset: 'claude_code' },
    allowedTools: input.allowedTools,
    disallowedTools: input.disallowedTools,
    settingSources: [],
    settings: { permissions: { allow: buildPermissionAllowRules(input.alwaysAllowRules) } },
    permissionMode: s.agent.permissionMode,
    allowDangerouslySkipPermissions: s.agent.permissionMode === 'bypassPermissions' ? true : undefined,
    includePartialMessages: true,
    persistSession: true,
    maxTurns: s.agent.maxTurns,
    maxBudgetUsd: s.agent.maxBudgetUsd > 0 ? s.agent.maxBudgetUsd : undefined,
    model: s.agent.model || undefined,
    fallbackModel: s.agent.fallbackModel || undefined,
    effort: s.agent.effort === 'default' ? undefined : s.agent.effort,
    mcpServers: input.mcpServers,
    strictMcpConfig: true,
    canUseTool: input.canUseTool,
    hooks: {
      ...input.hooks,
      PreToolUse: [...(input.hooks?.PreToolUse ?? []), { hooks: [dangerConfirmationHook] }],
    },
    stderr: input.stderr,
    abortController: input.abortController,
    pathToClaudeCodeExecutable: input.claudeBinary,
    resume: input.resume,
    debugFile: input.debugFile,
    title: undefined,
  }
  return options
}
