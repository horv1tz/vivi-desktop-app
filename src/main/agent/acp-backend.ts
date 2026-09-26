import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  type AgentCapabilities,
  type Client,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ElicitationPropertySchema,
  type Implementation,
  type McpServer as AcpMcpServer,
  type PermissionOption,
  type PermissionOptionKind,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionModeState,
} from '@agentclientprotocol/sdk'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY, deleteSession as sdkDeleteSession, getSessionMessages, listSessions as sdkListSessions, renameSession as sdkRenameSession, type Options as SdkOptions } from '@anthropic-ai/claude-agent-sdk'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentStateSnapshot, SendArgs } from '@shared/ipc'
import type { AgentErrorCode, AgentUiEvent, PermissionCategory, QuestionItem, SessionState, SessionSummary, UiBlock, UiMessage } from '@shared/events'
import type { Settings } from '@shared/settings'
import type { AgentBackend } from './backend'
import { buildEnv, buildPermissionAllowRules } from './options'
import { buildSystemPrompt, osVersionString } from './prompt'
import { historyToUi, makeError } from './reducer'
import { PermissionBroker, type BrokerUi } from './permissions/broker'
import { autoAllowedTools, makePolicy, type PolicyState } from './permissions/policy'
import { AcpTranslator, toolNameOf } from './acp/translate'
import { spawnAcpProcess, type AcpProcess } from './acp/process'
import { MCP_TOKEN_ENV, ViviMcpHttpServer } from './acp/mcp-http'
import { splitArgs } from './acp/args'

export interface AcpBackendDeps {
  getSettings: () => Settings
  updateSettings: (patch: { permissions: { alwaysAllowRules: { toolName: string; ruleContent?: string }[] } }) => void
  getExtraEnv: () => Promise<Record<string, string | undefined>>
  isolateConfig: () => boolean
  cwd: () => string
  homeDir: string
  memoryFile: () => string
  claudeConfigDir: string
  /** Explicit Claude Code binary (packaged builds); handed to the adapter as CLAUDE_CODE_EXECUTABLE. */
  claudeBinary?: string
  /** Entry script of the bundled claude-agent-acp adapter (null when missing). */
  adapterEntry: () => string | null
  /** Bootstrap that runs the adapter under Electron-as-Node without leaking ELECTRON_RUN_AS_NODE to its children. */
  adapterBootstrap: () => string | null
  /** Fresh MCP server with Vivi's tools, served to the agent over local HTTP. */
  createMcpServer: () => McpServer
  ui: BrokerUi
  appVersion: string
  /** JSON file for locally kept session titles (ACP has no rename method). */
  titlesFile: string
  debugFile?: () => string | undefined
  log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void; debug: (...a: unknown[]) => void }
  initTimeoutMs?: number
}

interface Connection {
  process: AcpProcess
  connection: ClientSideConnection
  capabilities: AgentCapabilities
  agentInfo: Implementation | null
  isClaudeAdapter: boolean
}

class AcpProcessExitedError extends Error {}

const FALLBACK_MODELS = [
  { id: 'claude-opus-5', name: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
]

const MODE_FOR_PERMISSION: Record<Settings['agent']['permissionMode'], string[]> = {
  default: ['default'],
  acceptEdits: ['acceptEdits'],
  auto: ['auto', 'acceptEdits'],
  bypassPermissions: ['bypassPermissions', 'auto', 'acceptEdits'],
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

export function mapAcpError(err: unknown): { code: AgentErrorCode; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  const code = err instanceof RequestError ? err.code : undefined
  if (code === RequestError.authRequired().code || /not logged in|authentication|unauthori[sz]ed|invalid api key|log ?in/i.test(message)) return { code: 'authentication_failed', message }
  if (/rate.?limit|usage limit|429/i.test(message)) return { code: 'rate_limit', message }
  if (/overloaded|529/i.test(message)) return { code: 'overloaded', message }
  if (/billing|credit balance/i.test(message)) return { code: 'billing_error', message }
  if (/max.?turns/i.test(message)) return { code: 'max_turns', message }
  if (/budget/i.test(message)) return { code: 'max_budget', message }
  if (/timed out|ENOENT|spawn|exited|not found/i.test(message)) return { code: 'startup_failed', message }
  return { code: 'unknown', message }
}

/**
 * The option that persists a plain allow rule ("Yes, and don't ask again …"). Other `allow_always`
 * options carry different semantics (ExitPlanMode's "clear context and use auto mode") and must never
 * be selected on behalf of a generic "always allow" click.
 */
export function findAlwaysAllowOption(options: PermissionOption[]): PermissionOption | undefined {
  return options.find((o) => o.kind === 'allow_always' && (o.optionId === 'allow-with-updates' || (!o.optionId.startsWith('exit-plan') && /don.?t ask again/i.test(o.name))))
}

/** Pick the ACP permission option for a user decision. */
export function selectPermissionOption(options: PermissionOption[], decision: 'allow' | 'allow-always' | 'deny'): PermissionOption | undefined {
  const pick = (...kinds: PermissionOptionKind[]): PermissionOption | undefined => {
    for (const k of kinds) {
      const o = options.find((x) => x.kind === k)
      if (o) return o
    }
    return undefined
  }
  if (decision === 'deny') return pick('reject_once', 'reject_always')
  const once = options.find((o) => o.optionId === 'allow-once') ?? pick('allow_once')
  if (decision === 'allow-always') return findAlwaysAllowOption(options) ?? once
  return once ?? findAlwaysAllowOption(options)
}

/**
 * Rule persisted locally for "always allow". ACP carries no rule content, so only rules that can be
 * scoped safely are derived (shell command prefix, fetched host); anything else returns null and the
 * grant is downgraded to "this session" instead of persisting a blanket tool allow.
 */
export function alwaysAllowRuleFor(toolName: string, input: Record<string, unknown>): { toolName: string; ruleContent: string } | null {
  if ((toolName === 'Bash' || toolName === 'PowerShell') && typeof input.command === 'string') {
    const first = input.command.trim().split(/\s+/)[0]
    if (first && /^[\w./-]+$/.test(first) && !/^(sudo|su|doas|eval|source|exec|sh|bash|zsh|cmd|powershell|pwsh|xargs|env)$/i.test(first)) return { toolName, ruleContent: `${first}:*` }
    return null
  }
  if (toolName === 'WebFetch' && typeof input.url === 'string') {
    try {
      const host = new URL(input.url).hostname
      if (host) return { toolName, ruleContent: `domain:${host}` }
    } catch {
      /* not a URL */
    }
  }
  return null
}

interface FormField {
  key: string
  multi: boolean
  labels: string[]
  /** label → schema `const` value (differs from the label for MCP forms and CLI dialogs). */
  values: Record<string, string | number | boolean>
  customKey?: string
}

/** Convert an ACP form elicitation (AskUserQuestion, MCP elicitation) into Vivi question items. */
export function formToQuestions(params: CreateElicitationRequest): { questions: QuestionItem[]; fields: FormField[] } {
  const schema = (params.mode === 'form' ? (params as { requestedSchema?: { properties?: Record<string, ElicitationPropertySchema> } }).requestedSchema : undefined) ?? {}
  const props = schema.properties ?? {}
  const questions: QuestionItem[] = []
  const fields: FormField[] = []
  type EnumOpt = { const?: unknown; title?: string; description?: string | null }
  const isCustom = (key: string, p: unknown): boolean => {
    const meta = (p as { _meta?: Record<string, unknown> })._meta
    if (meta && Object.values(meta).some((v) => typeof v === 'object' && v !== null && (v as { isCustomAnswer?: boolean }).isCustomAnswer)) return true
    return key.endsWith('_custom') && `${key.slice(0, -'_custom'.length)}` in props
  }
  for (const [key, raw] of Object.entries(props)) {
    if (isCustom(key, raw)) continue
    const p = raw as { type?: string; title?: string | null; description?: string | null; oneOf?: EnumOpt[]; enum?: unknown[]; items?: { anyOf?: EnumOpt[]; enum?: unknown[] } }
    const multi = p.type === 'array'
    const enumOpts: EnumOpt[] = multi ? (p.items?.anyOf ?? (p.items?.enum ?? []).map((v) => ({ const: v, title: String(v) }))) : (p.oneOf ?? (p.enum ?? []).map((v) => ({ const: v, title: String(v) })))
    const options = enumOpts.map((o) => ({ label: String(o.title ?? o.const ?? ''), description: o.description ?? undefined, value: o.const })).filter((o) => o.label)
    questions.push({ question: p.description ?? params.message, header: p.title ?? undefined, multiSelect: multi, options: options.map((o) => ({ label: o.label, description: o.description })) })
    const customKey = `${key}_custom` in props ? `${key}_custom` : undefined
    const values: Record<string, string | number | boolean> = {}
    for (const o of options) values[o.label] = typeof o.value === 'string' || typeof o.value === 'number' || typeof o.value === 'boolean' ? o.value : o.label
    fields.push({ key, multi, labels: options.map((o) => o.label), values, customKey })
  }
  return { questions, fields }
}

/** Fold dialog answers (label list joined by ", " plus optional free text) back into form content. */
export function answersToFormContent(answers: Record<string, string>, questions: QuestionItem[], fields: FormField[]): Record<string, string | number | boolean | string[]> {
  const content: Record<string, string | number | boolean | string[]> = {}
  questions.forEach((q, i) => {
    const f = fields[i]!
    const raw = answers[q.question]
    if (raw === undefined || raw === '') return
    // The dialog joins picked labels (and free text) with ", "; labels may themselves contain ", ",
    // so peel known labels off the front greedily (longest first) and treat the remainder as free text.
    const byLength = [...f.labels].sort((a, b) => b.length - a.length)
    const picked: string[] = []
    let rest = raw
    for (;;) {
      const label = byLength.find((l) => rest === l || rest.startsWith(`${l}, `))
      if (!label) break
      picked.push(label)
      rest = rest === label ? '' : rest.slice(label.length + 2)
    }
    const custom = rest.trim()
    const pickedValues = picked.map((l) => f.values[l] ?? l)
    if (f.multi) {
      if (pickedValues.length) content[f.key] = pickedValues.map(String)
      if (custom) {
        if (f.customKey) content[f.customKey] = custom
        else content[f.key] = [...pickedValues.map(String), custom]
      }
    } else {
      if (pickedValues.length) content[f.key] = pickedValues[0]!
      if (custom) {
        if (f.customKey) content[f.customKey] = custom
        else if (!picked.length) content[f.key] = raw
      }
    }
  })
  return content
}

/**
 * AgentBackend speaking the Agent Client Protocol to an external agent process.
 * Default agent: the bundled claude-agent-acp adapter (Claude Code over ACP); any other ACP agent can
 * be configured with a command line. Vivi's own tools are exposed to the agent over a local MCP endpoint.
 */
export class AcpBackend implements AgentBackend {
  readonly kind = 'acp' as const
  readonly broker: PermissionBroker
  private listeners = new Set<(e: AgentUiEvent) => void>()
  private conn: Connection | null = null
  private connecting: Promise<Connection> | null = null
  /** Bumped by teardown(); async start paths abandon their work when it changes under them. */
  private generation = 0
  private disposed = false
  private pendingPrompts: { turnId: string; blocks: ContentBlock[] }[] = []
  private pumping = false
  private lastExit: { code: number | null; signal: NodeJS.Signals | null } | null = null
  private sessionId: string | null = null
  private sessionReady: Promise<UiMessage[]> | null = null
  private selectedSessionId: string | null = null
  private selectedTitle: string | null = null
  private _state: SessionState = 'idle'
  private readonly translator = new AcpTranslator({ emit: (e) => this.emit(e) })
  private turnAbort: AbortController | null = null
  private inFlight = false
  private modes: SessionModeState | null = null
  private configOptions: SessionConfigOption[] | null = null
  private readonly mcp: ViviMcpHttpServer
  private titles: Record<string, string> = {}
  private history: UiMessage[] = []
  private stderrTail: string[] = []
  private voiceMode = false
  private policyState: PolicyState = { sessionGrants: new Set<PermissionCategory>(), turnGrants: new Set<PermissionCategory>() }

  constructor(private readonly deps: AcpBackendDeps) {
    this.mcp = new ViviMcpHttpServer({ createServer: deps.createMcpServer, log: deps.log })
    this.broker = new PermissionBroker({
      ui: deps.ui,
      policy: makePolicy(() => deps.getSettings().permissions, this.policyState),
      onAlwaysAllow: (rules) => {
        const cur = deps.getSettings().permissions.alwaysAllowRules
        const next = [...cur]
        for (const r of rules) if (!next.some((x) => x.toolName === r.toolName && x.ruleContent === r.ruleContent)) next.push(r)
        deps.updateSettings({ permissions: { alwaysAllowRules: next } })
      },
      onSessionAllow: (category) => this.policyState.sessionGrants.add(category),
      onTurnAllow: (category) => this.policyState.turnGrants.add(category),
    })
    this.loadTitles()
  }

  // ---------- events / state ----------

  onEvent(listener: (event: AgentUiEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(e: AgentUiEvent): void {
    if (e.type === 'state') this._state = e.state
    if (e.type === 'session') this._state = e.state
    if (e.type === 'result') this.policyState.turnGrants.clear()
    if (e.type === 'user-message') this.history.push(e.message)
    if (e.type === 'assistant-message') {
      const i = this.history.findIndex((m) => m.id === e.message.id)
      if (i === -1) this.history.push(e.message)
      else this.history[i] = e.message
    }
    for (const l of this.listeners) l(e)
  }

  private setState(state: SessionState): void {
    if (this._state === state) return
    this.emit({ type: 'state', state })
  }

  getState(): AgentStateSnapshot {
    return {
      sessionId: this.sessionId ?? this.selectedSessionId,
      state: this._state,
      model: this.currentModel() ?? (this.deps.getSettings().agent.model || null),
      title: this.selectedTitle,
      totalCostUsd: 0,
    }
  }

  private currentModel(): string | null {
    const opt = this.configOptions?.find((o) => o.id === 'model')
    return opt && opt.type === 'select' ? String(opt.currentValue) : null
  }

  // ---------- lifecycle ----------

  async start(): Promise<void> {
    const s = this.deps.getSettings()
    this.emit({ type: 'state', state: 'idle' })
    if (!s.agent.continueLastSession) return
    try {
      const [last] = await this.listSessions()
      if (!last) return
      this.selectedSessionId = last.sessionId
      this.selectedTitle = last.title || null
      // Claude sessions are plain files: show the history now and attach the agent lazily on first send.
      const messages = this.isClaudeAdapter() ? await this.loadClaudeHistory(last.sessionId) : await this.ensureSession()
      this.history = messages
      this.emit({ type: 'session', sessionId: last.sessionId, state: 'idle', model: this.currentModel() ?? undefined, title: this.selectedTitle ?? undefined })
      this.emit({ type: 'history', messages })
    } catch (err) {
      this.deps.log.warn('could not restore last ACP session', err)
      this.emit({ type: 'state', state: 'idle' })
    }
  }

  /** History of a Claude Code session straight from its transcript (same files the adapter replays). */
  private async loadClaudeHistory(sessionId: string): Promise<UiMessage[]> {
    const entries = await getSessionMessages(sessionId, { dir: this.deps.cwd(), includeSystemMessages: false })
    return historyToUi(entries)
  }

  async restart(): Promise<void> {
    await this.teardown()
    this.emit({ type: 'state', state: 'idle' })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.teardown()
    this.emit({ type: 'state', state: 'closed' })
  }

  /** Stop the agent process and the MCP endpoint; keeps the selected session id for a lazy resume. */
  private async teardown(): Promise<void> {
    this.generation++
    this.pendingPrompts = []
    this.broker.cancelAll()
    this.turnAbort?.abort()
    const conn = this.conn
    this.conn = null
    this.connecting = null
    this.sessionId = null
    this.sessionReady = null
    this.modes = null
    this.configOptions = null
    this.translator.reset()
    if (conn) {
      if (this.inFlight) {
        try {
          await conn.connection.cancel({ sessionId: this.selectedSessionId ?? '' })
        } catch {
          /* ignore */
        }
      }
      await conn.process.stop()
    }
    await this.mcp.stop()
  }

  // ---------- connection / session ----------

  private isClaudeAdapter(): boolean {
    return !this.deps.getSettings().agent.acpCommand.trim()
  }

  private async ensureConnection(): Promise<Connection> {
    if (this.conn?.process.isRunning) return this.conn
    if (this.connecting) return this.connecting
    this.connecting = this.connect().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private async connect(): Promise<Connection> {
    const generation = this.generation
    const settings = this.deps.getSettings()
    const custom = settings.agent.acpCommand.trim()
    const extraArgs = splitArgs(settings.agent.acpArgs)
    const env = buildEnv({ extraEnv: await this.deps.getExtraEnv(), claudeConfigDir: this.deps.claudeConfigDir, appVersion: this.deps.appVersion, isolateConfig: this.deps.isolateConfig() })
    let command: string
    let args: string[]
    if (custom) {
      command = custom
      args = extraArgs
      // A third-party agent gets proxy settings but not Vivi's Claude credentials.
      for (const k of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN']) delete env[k]
    } else {
      const entry = this.deps.adapterEntry()
      if (!entry) throw new Error('The bundled Claude ACP adapter (claude-agent-acp) is missing from this build')
      const bootstrap = this.deps.adapterBootstrap()
      command = process.execPath
      args = bootstrap ? [bootstrap, entry, ...extraArgs] : [entry, ...extraArgs]
      env.ELECTRON_RUN_AS_NODE = '1'
      env[MCP_TOKEN_ENV] = this.mcp.bearerToken
      if (this.deps.claudeBinary) env.CLAUDE_CODE_EXECUTABLE = this.deps.claudeBinary
      // The adapter offers OAuth over a terminal; Vivi handles login itself (Settings → Account).
      env.NO_BROWSER = '1'
    }
    this.stderrTail = []
    this.deps.log.info(`starting ACP agent: ${command} ${args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`)
    const proc = spawnAcpProcess({
      command,
      args,
      env,
      cwd: this.deps.cwd(),
      onStderr: (line) => {
        if (!line.trim()) return
        this.stderrTail.push(line)
        if (this.stderrTail.length > 200) this.stderrTail.shift()
        this.deps.log.debug('[acp]', line)
      },
      onExit: (info) => this.onProcessExit(proc, info),
    })
    const client: Client = {
      requestPermission: (params) => this.onRequestPermission(params),
      sessionUpdate: (params) => {
        if (params.sessionId === this.sessionId) this.translator.handle(params)
      },
      createElicitation: (params) => this.onElicitation(params),
      extNotification: (method, params) => {
        this.deps.log.debug(`[acp] ${method}`, params)
      },
    }
    const connection = new ClientSideConnection(() => client, proc.stream)
    try {
      const init = await withTimeout(
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} } },
          clientInfo: { name: 'vivi', title: 'Vivi', version: this.deps.appVersion },
        }),
        this.deps.initTimeoutMs ?? 30_000,
        'ACP initialize',
      )
      if (generation !== this.generation || this.disposed) throw new Error('ACP agent start was cancelled')
      const conn: Connection = { process: proc, connection, capabilities: init.agentCapabilities ?? {}, agentInfo: init.agentInfo ?? null, isClaudeAdapter: !custom }
      this.conn = conn
      this.deps.log.info(`ACP agent ready: ${conn.agentInfo?.name ?? 'unknown'} ${conn.agentInfo?.version ?? ''} (protocol ${init.protocolVersion})`)
      return conn
    } catch (err) {
      await proc.stop(500)
      const tail = this.stderrTail.slice(-20).join('\n')
      throw new Error(`${err instanceof Error ? err.message : String(err)}${tail ? `\n${tail}` : ''}`, { cause: err })
    }
  }

  private onProcessExit(proc: AcpProcess, info: { code: number | null; signal: NodeJS.Signals | null }): void {
    if (this.conn?.process !== proc) return // already replaced / stopped on purpose
    this.deps.log.error(`ACP agent exited (code ${info.code}, signal ${info.signal})`, this.stderrTail.slice(-20).join('\n'))
    this.lastExit = info
    this.conn = null
    this.sessionId = null
    this.sessionReady = null
    this.pendingPrompts = []
    this.broker.cancelAll()
    // An in-flight prompt observes the exit through runPrompt's race and reports it once.
    if (!this.inFlight) this.setState('failed')
    void this.mcp.stop()
  }

  private exitError(): Error {
    const info = this.lastExit
    return new AcpProcessExitedError(`ACP agent exited (code ${info?.code ?? 'null'}${info?.signal ? `, signal ${info.signal}` : ''})\n${this.stderrTail.slice(-20).join('\n')}`.trim())
  }

  private claudeOptions(): Record<string, unknown> {
    const s = this.deps.getSettings()
    const { staticPart, dynamicPart } = buildSystemPrompt({
      platform: process.platform,
      osVersion: osVersionString(),
      locale: s.appearance.language,
      workspaceDir: this.deps.cwd(),
      homeDir: this.deps.homeDir,
      memoryFile: this.deps.memoryFile(),
      customInstructions: s.agent.customInstructions,
      voiceMode: this.voiceMode,
    })
    const options: Partial<SdkOptions> = {
      systemPrompt: { type: 'custom', prompt: [staticPart, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, dynamicPart], snapshot: true },
      settingSources: [],
      settings: { permissions: { allow: buildPermissionAllowRules(s.permissions.alwaysAllowRules) } },
      allowedTools: autoAllowedTools(s.permissions),
      additionalDirectories: [this.deps.homeDir, ...s.agent.additionalDirectories].filter((d, i, a) => a.indexOf(d) === i),
      maxTurns: s.agent.maxTurns,
      maxBudgetUsd: s.agent.maxBudgetUsd > 0 ? s.agent.maxBudgetUsd : undefined,
      model: s.agent.model || undefined,
      fallbackModel: s.agent.fallbackModel || undefined,
      effort: s.agent.effort === 'default' ? undefined : s.agent.effort,
      persistSession: true,
      strictMcpConfig: true,
      allowDangerouslySkipPermissions: s.agent.permissionMode === 'bypassPermissions' ? undefined : false,
      debugFile: this.deps.debugFile?.(),
    }
    return JSON.parse(JSON.stringify(options)) as Record<string, unknown>
  }

  private async mcpServers(viaEnv: boolean): Promise<AcpMcpServer[]> {
    const endpoint = await this.mcp.endpointFor(viaEnv)
    return [{ type: 'http', name: 'vivi', url: endpoint.url, headers: endpoint.headers }]
  }

  /** Creates or loads the selected session; resolves with the (replayed) history. */
  private ensureSession(): Promise<UiMessage[]> {
    if (this.sessionReady) return this.sessionReady
    const ready = this.openSession().catch((err) => {
      if (this.sessionReady === ready) this.sessionReady = null
      throw err
    })
    this.sessionReady = ready
    return ready
  }

  private async openSession(): Promise<UiMessage[]> {
    const generation = this.generation
    const conn = await this.ensureConnection()
    const cwd = this.deps.cwd()
    const mcpServers = await this.mcpServers(conn.isClaudeAdapter)
    if (generation !== this.generation || this.disposed) throw new Error('ACP session start was cancelled')
    const meta = conn.isClaudeAdapter ? { claudeCode: { options: this.claudeOptions() } } : undefined
    this.setState('starting')
    let messages: UiMessage[] = []
    try {
      if (this.selectedSessionId && conn.capabilities.loadSession) {
        this.sessionId = this.selectedSessionId
        this.translator.beginReplay()
        const res = await withTimeout(conn.connection.loadSession({ sessionId: this.selectedSessionId, cwd, mcpServers, _meta: meta }), 120_000, 'ACP session/load')
        const replayed = this.translator.endReplay()
        // For Claude the transcript was already rendered from disk (start/resume); other agents only have the replay.
        messages = conn.isClaudeAdapter && this.history.length ? this.history : replayed
        this.modes = res.modes ?? null
        this.configOptions = res.configOptions ?? null
      } else {
        const res = await withTimeout(conn.connection.newSession({ cwd, mcpServers, _meta: meta }), 120_000, 'ACP session/new')
        this.sessionId = res.sessionId
        this.selectedSessionId = res.sessionId
        this.modes = res.modes ?? null
        this.configOptions = res.configOptions ?? null
      }
    } catch (err) {
      this.translator.reset()
      this.sessionId = null
      this.setState('idle')
      throw err
    }
    if (generation !== this.generation || this.disposed) {
      this.translator.reset()
      this.sessionId = null
      throw new Error('ACP session start was cancelled')
    }
    this.translator.resetUsage()
    this.history = messages
    await this.applyPermissionMode(conn)
    this.emit({ type: 'session', sessionId: this.sessionId!, state: 'idle', model: this.currentModel() ?? undefined, title: this.selectedTitle ?? undefined })
    return messages
  }

  private async applyPermissionMode(conn: Connection): Promise<void> {
    if (!this.modes || !this.sessionId) return
    const wanted = MODE_FOR_PERMISSION[this.deps.getSettings().agent.permissionMode]
    const available = new Set(this.modes.availableModes.map((m) => m.id))
    const target = wanted.find((m) => available.has(m))
    if (!target || target === this.modes.currentModeId) return
    try {
      await conn.connection.setSessionMode({ sessionId: this.sessionId, modeId: target })
      this.modes = { ...this.modes, currentModeId: target }
    } catch (err) {
      this.deps.log.warn(`could not set ACP session mode ${target}`, err)
    }
  }

  // ---------- prompting ----------

  private userMessage(args: SendArgs): { ui: UiMessage; blocks: ContentBlock[] } {
    const blocks: ContentBlock[] = []
    const ui: UiBlock[] = []
    if (args.text.trim()) {
      blocks.push({ type: 'text', text: args.text })
      ui.push({ type: 'text', text: args.text })
    }
    for (const img of args.images ?? []) {
      blocks.push({ type: 'image', data: img.data, mimeType: img.mimeType })
      ui.push({ type: 'image', mimeType: img.mimeType, data: img.data })
    }
    return { ui: { id: randomUUID(), role: 'user', blocks: ui, timestamp: Date.now() }, blocks }
  }

  async send(args: SendArgs): Promise<{ messageId: string }> {
    if (this.disposed) throw new Error('agent backend is disposed')
    this.voiceMode = !!args.fromVoice
    const { ui, blocks } = this.userMessage(args)
    this.emit({ type: 'user-message', message: ui })
    this.pendingPrompts.push({ turnId: ui.id, blocks })
    void this.pump()
    return { messageId: ui.id }
  }

  /** Runs queued prompts one at a time; interrupt()/teardown() drop whatever is still queued. */
  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.pendingPrompts.length && !this.disposed) {
        const next = this.pendingPrompts.shift()!
        await this.runPrompt(next.turnId, next.blocks).catch((err) => this.deps.log.warn('prompt failed', err))
      }
    } finally {
      this.pumping = false
    }
  }

  private async runPrompt(turnId: string, blocks: ContentBlock[]): Promise<void> {
    let conn: Connection
    try {
      await this.ensureSession()
      conn = await this.ensureConnection()
    } catch (err) {
      const mapped = mapAcpError(err)
      this.deps.log.error('ACP session start failed', mapped.message)
      this.emit({ type: 'error', error: makeError(mapped.code === 'unknown' ? 'startup_failed' : mapped.code, mapped.message) })
      this.setState('idle')
      return
    }
    const sessionId = this.sessionId!
    this.inFlight = true
    const abort = new AbortController()
    this.turnAbort = abort
    this.translator.beginTurn()
    this.setState('running')
    let settled = false
    // A dead agent never answers: race the request against the process exiting.
    const exited = new Promise<never>((_, reject) => {
      void conn.process.exited.then(() => {
        if (!settled) reject(this.exitError())
      })
    })
    try {
      const res = await Promise.race([conn.connection.prompt({ sessionId, prompt: blocks }), exited])
      settled = true
      this.translator.finishTurn(res, { turnId })
      if (res.stopReason === 'refusal') this.emit({ type: 'error', error: makeError('unknown', 'The model declined to continue this turn.') })
      if (res.stopReason === 'max_turn_requests') this.emit({ type: 'error', error: makeError('max_turns', 'Step limit reached') })
    } catch (err) {
      settled = true
      const mapped = err instanceof AcpProcessExitedError ? { code: 'process_exited' as const, message: err.message } : mapAcpError(err)
      this.deps.log.error('ACP prompt failed', mapped.message)
      this.translator.finishTurn(null, { turnId, error: true })
      this.emit({ type: 'error', error: makeError(mapped.code, mapped.message) })
    } finally {
      this.inFlight = false
      abort.abort() // closes any permission/question dialog still waiting on this turn
      if (this.turnAbort === abort) this.turnAbort = null
      if (this.conn === conn) this.setState('idle')
      else if (!this.disposed) this.setState('failed')
    }
  }

  async interrupt(): Promise<void> {
    this.pendingPrompts = []
    this.broker.cancelAll()
    this.turnAbort?.abort()
    if (this.inFlight && this.conn && this.sessionId) {
      try {
        await this.conn.connection.cancel({ sessionId: this.sessionId })
      } catch (err) {
        this.deps.log.warn('ACP cancel failed', err)
      }
    }
  }

  // ---------- permissions / questions ----------

  private async onRequestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const toolName = toolNameOf(params.toolCall)
    const input = (params.toolCall.rawInput && typeof params.toolCall.rawInput === 'object' ? params.toolCall.rawInput : {}) as Record<string, unknown>
    const select = (o: PermissionOption | undefined): RequestPermissionResponse => (o ? { outcome: { outcome: 'selected', optionId: o.optionId } } : { outcome: { outcome: 'cancelled' } })
    const decision = this.broker.decide(toolName, input)
    if (decision.verdict === 'allow') return select(selectPermissionOption(params.options, 'allow'))
    if (decision.verdict === 'deny') return select(selectPermissionOption(params.options, 'deny'))
    const alwaysOffered = findAlwaysAllowOption(params.options) !== undefined
    const prev = this._state
    this.setState('awaiting_permission')
    const answer = await this.broker.ask(
      {
        toolName,
        input,
        title: params.toolCall.title ?? undefined,
        category: decision.category,
        dangerous: decision.dangerous,
        dangerReasons: decision.dangerReasons,
        canAlwaysAllow: decision.canAlwaysAllow && !decision.dangerous && alwaysOffered,
        suggestionsCount: alwaysOffered ? 1 : 0,
      },
      this.turnAbort?.signal,
    )
    if (this._state === 'awaiting_permission') this.setState(prev === 'awaiting_permission' ? 'running' : prev)
    const rule = alwaysAllowRuleFor(toolName, input)
    // No scoped rule to persist → remember the grant for this session only.
    const effective = answer === 'allow-always' ? (alwaysOffered && rule ? 'allow-always' : 'allow-session') : answer
    this.broker.applyDecision(effective, decision.category, rule ? [rule] : [])
    switch (effective) {
      case 'allow':
      case 'allow-session':
        return select(selectPermissionOption(params.options, 'allow'))
      case 'allow-always':
        return select(selectPermissionOption(params.options, 'allow-always'))
      default:
        return select(selectPermissionOption(params.options, 'deny'))
    }
  }

  private async onElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    if (params.mode !== 'form') return { action: 'cancel' }
    const { questions, fields } = formToQuestions(params)
    if (!questions.length) return { action: 'decline' }
    const prev = this._state
    this.setState('awaiting_question')
    const answers = await this.broker.askQuestions(questions, this.turnAbort?.signal)
    if (this._state === 'awaiting_question') this.setState(prev === 'awaiting_question' ? 'running' : prev)
    if (!Object.keys(answers).length) return { action: 'cancel' }
    return { action: 'accept', content: answersToFormContent(answers, questions, fields) }
  }

  // ---------- sessions ----------

  async newSession(): Promise<void> {
    await this.teardown()
    this.selectedSessionId = null
    this.selectedTitle = null
    this.history = []
    this.policyState.sessionGrants.clear()
    this.policyState.turnGrants.clear()
    this.emit({ type: 'session', sessionId: '', state: 'idle', title: undefined })
    this.emit({ type: 'history', messages: [] })
  }

  async listSessions(): Promise<SessionSummary[]> {
    if (this.isClaudeAdapter()) {
      try {
        const list = await sdkListSessions({ dir: this.deps.cwd(), limit: 100 })
        return list.map((s) => ({ sessionId: s.sessionId, title: s.customTitle ?? s.summary ?? '', lastModified: s.lastModified, firstPrompt: s.firstPrompt }))
      } catch (err) {
        this.deps.log.warn('listSessions failed', err)
        return []
      }
    }
    try {
      const conn = await this.ensureConnection()
      if (!conn.capabilities.sessionCapabilities?.list) return []
      const cwd = this.deps.cwd()
      const out: SessionSummary[] = []
      let cursor: string | null | undefined
      do {
        const res = await conn.connection.listSessions({ cwd, cursor: cursor ?? undefined })
        for (const s of res.sessions) {
          out.push({ sessionId: s.sessionId, title: this.titles[s.sessionId] ?? s.title ?? '', lastModified: s.updatedAt ? Date.parse(s.updatedAt) || 0 : 0 })
        }
        cursor = res.nextCursor
      } while (cursor && out.length < 500)
      out.sort((a, b) => b.lastModified - a.lastModified)
      return out.slice(0, 100)
    } catch (err) {
      this.deps.log.warn('ACP session/list failed', err)
      return []
    }
  }

  async resumeSession(sessionId: string): Promise<UiMessage[]> {
    if (this.sessionId === sessionId && this.conn?.process.isRunning) return this.history
    await this.teardown()
    this.selectedSessionId = sessionId
    this.policyState.sessionGrants.clear()
    const info = (await this.listSessions()).find((s) => s.sessionId === sessionId)
    this.selectedTitle = info?.title || null
    if (this.isClaudeAdapter()) {
      const messages = await this.loadClaudeHistory(sessionId)
      this.history = messages
      this.emit({ type: 'session', sessionId, state: 'idle', title: this.selectedTitle ?? undefined })
      return messages
    }
    return this.ensureSession()
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    if (this.isClaudeAdapter()) {
      await sdkRenameSession(sessionId, title, { dir: this.deps.cwd() })
    } else {
      this.titles[sessionId] = title
      this.saveTitles()
    }
    if (sessionId === this.selectedSessionId) this.selectedTitle = title
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.sessionId === sessionId || this.selectedSessionId === sessionId) await this.newSession()
    if (this.isClaudeAdapter()) {
      await sdkDeleteSession(sessionId, { dir: this.deps.cwd() })
      return
    }
    delete this.titles[sessionId]
    this.saveTitles()
    try {
      const conn = await this.ensureConnection()
      if (conn.capabilities.sessionCapabilities?.delete) await conn.connection.deleteSession({ sessionId })
    } catch (err) {
      this.deps.log.warn('ACP session/delete failed', err)
    }
  }

  async listModels(): Promise<{ id: string; name: string; description?: string }[]> {
    const opt = this.configOptions?.find((o) => o.id === 'model')
    if (opt && opt.type === 'select') {
      const flat = opt.options.flatMap((o) => ('group' in o ? o.options : [o]))
      const models = flat.map((o) => ({ id: String(o.value), name: o.name, description: o.description ?? undefined }))
      if (models.length) return models
    }
    return FALLBACK_MODELS
  }

  private loadTitles(): void {
    try {
      if (existsSync(this.deps.titlesFile)) this.titles = JSON.parse(readFileSync(this.deps.titlesFile, 'utf8')) as Record<string, string>
    } catch {
      this.titles = {}
    }
  }

  private saveTitles(): void {
    try {
      writeFileSync(this.deps.titlesFile, JSON.stringify(this.titles, null, 2))
    } catch (err) {
      this.deps.log.warn('could not save session titles', err)
    }
  }
}
