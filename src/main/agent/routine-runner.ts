import { query, type CanUseTool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { RoutineEntry, RoutineRunResult } from '@shared/events'
import type { Settings } from '@shared/settings'
import { buildOptions } from './options'
import {
  autoAllowedTools,
  EDIT_TOOLS,
  EXEC_TOOLS,
  INPUT_TOOLS,
  makePolicy,
  READ_ONLY_TOOLS,
  SYSTEM_TOOLS,
} from './permissions/policy'

/**
 * SCH-01: a routine runs with nobody watching, so it can't ever show a permission dialog and wait
 * — there is no one to answer it. Two independent safety layers, not one:
 *  - `safeMode` (the routine's own setting, default on) restricts the tool set itself via
 *    `allowedTools`/`disallowedTools` to read-only tools, so the model isn't even offered
 *    anything that could act on the system.
 *  - Regardless of safeMode, any tool call that would normally prompt a dialog is auto-denied
 *    instead of asked — it only proceeds if it's already covered by an existing always-allow rule
 *    (set up through ordinary chat use or Settings → Permissions), reusing the exact same
 *    `makePolicy` rule engine the live chat uses, not a re-derivation of it.
 */
const RESTRICTED_TOOLS = [...EDIT_TOOLS, ...EXEC_TOOLS, ...INPUT_TOOLS, ...SYSTEM_TOOLS]

/** A runaway unattended loop is a real risk a live chat doesn't have (nobody's there to hit stop) — capped independently of the user's own chat maxTurns setting. */
const MAX_ROUTINE_TURNS = 30

export interface RoutineRunnerDeps {
  getSettings: () => Settings
  getExtraEnv: () => Promise<Record<string, string | undefined>>
  isolateConfig: () => boolean
  cwd: () => string
  homeDir: string
  memoryFile: () => string
  skillsFile: () => string
  scenariosFile: () => string
  routinesFile: () => string
  claudeConfigDir: string
  claudeBinary?: string
  appVersion: string
  /** Vivi's own MCP tools (screenshot, notify, browser, …) — same server the live chat gets. */
  mcpServer: () => McpServerConfig
  /** Injectable for tests; defaults to the real SDK `query`. */
  queryFn?: typeof query
}

/** Runs one routine's prompt to completion as a single, isolated, non-interactive turn — never through the live chat session, so it can't interleave with (or show up inside) whatever the user is doing in the main window. */
export async function runRoutineOnce(
  routine: RoutineEntry,
  deps: RoutineRunnerDeps,
): Promise<RoutineRunResult> {
  const timestamp = Date.now()
  const settings = deps.getSettings()
  const policy = makePolicy(() => settings.permissions, {
    sessionGrants: new Set(),
    turnGrants: new Set(),
  })
  const canUseTool: CanUseTool = async (toolName, input) => {
    if (toolName === 'AskUserQuestion')
      return {
        behavior: 'deny',
        message: 'This routine ran unattended; nobody could answer a question.',
      }
    const decision = policy(toolName, input)
    if (decision.verdict === 'allow') return { behavior: 'allow', updatedInput: input }
    return {
      behavior: 'deny',
      message:
        decision.denyMessage ??
        `"${toolName}" needs approval to run unattended. Add an always-allow rule in Settings → Permissions, or turn off this routine's safe mode.`,
    }
  }

  let options
  try {
    const extraEnv = await deps.getExtraEnv()
    options = buildOptions({
      settings,
      cwd: deps.cwd(),
      homeDir: deps.homeDir,
      memoryFile: deps.memoryFile(),
      skillsFile: deps.skillsFile(),
      scenariosFile: deps.scenariosFile(),
      routinesFile: deps.routinesFile(),
      claudeConfigDir: deps.claudeConfigDir,
      extraEnv,
      claudeBinary: deps.claudeBinary,
      appVersion: deps.appVersion,
      allowedTools: routine.safeMode ? READ_ONLY_TOOLS : autoAllowedTools(settings.permissions),
      disallowedTools: routine.safeMode ? RESTRICTED_TOOLS : undefined,
      alwaysAllowRules: settings.permissions.alwaysAllowRules,
      mcpServers: { vivi: deps.mcpServer() },
      canUseTool,
      isolateConfig: deps.isolateConfig(),
    })
  } catch (err) {
    return { timestamp, summary: err instanceof Error ? err.message : String(err), isError: true }
  }
  options.maxTurns = Math.min(options.maxTurns ?? MAX_ROUTINE_TURNS, MAX_ROUTINE_TURNS)

  const queryFn = deps.queryFn ?? query
  try {
    for await (const message of queryFn({ prompt: routine.prompt, options })) {
      if (message.type !== 'result') continue
      if (message.subtype === 'success')
        return { timestamp, summary: message.result || '(no output)', isError: message.is_error }
      return {
        timestamp,
        summary: message.errors?.join('; ') || `stopped: ${message.subtype}`,
        isError: true,
      }
    }
    return { timestamp, summary: 'the agent produced no result', isError: true }
  } catch (err) {
    return { timestamp, summary: err instanceof Error ? err.message : String(err), isError: true }
  }
}
