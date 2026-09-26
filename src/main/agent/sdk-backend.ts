import { app } from 'electron'
import { deleteSession, getSessionMessages, listSessions, query, renameSession, type McpServerConfig, type Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentStateSnapshot, SendArgs } from '@shared/ipc'
import type { AgentUiEvent, PermissionCategory, SessionSummary, UiMessage } from '@shared/events'
import type { Settings } from '@shared/settings'
import type { AgentBackend } from './backend'
import { AgentSession } from './session'
import { buildOptions } from './options'
import { historyToUi, makeError } from './reducer'
import { PermissionBroker, type BrokerUi } from './permissions/broker'
import { autoAllowedTools, makePolicy, type PolicyState } from './permissions/policy'
import { logger } from '../logging/log'

const log = logger('sdk-backend')

export interface SdkBackendDeps {
  getSettings: () => Settings
  updateSettings: (patch: { permissions: { alwaysAllowRules: { toolName: string; ruleContent?: string }[] } }) => void
  /** Env pieces for auth + proxy, resolved at spawn time. */
  getExtraEnv: () => Promise<Record<string, string | undefined>>
  isolateConfig: () => boolean
  cwd: () => string
  homeDir: string
  memoryFile: () => string
  claudeConfigDir: string
  claudeBinary?: string
  mcpServers?: () => Record<string, McpServerConfig>
  ui: BrokerUi
  debugFile?: () => string | undefined
}

const FALLBACK_MODELS = [
  { id: 'claude-opus-5', name: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
]

/**
 * AgentBackend on top of the Claude Agent SDK. Keeps exactly one live CLI process; sessions are
 * spawned lazily on first send (resume when a session id is selected) and torn down on switch.
 */
export class SdkBackend implements AgentBackend {
  readonly kind = 'sdk' as const
  private listeners = new Set<(e: AgentUiEvent) => void>()
  private session: AgentSession | null = null
  private selectedSessionId: string | null = null
  private selectedTitle: string | null = null
  private totalCost = 0
  private starting: Promise<AgentSession> | null = null
  private cachedModels: { id: string; name: string; description?: string }[] = []
  private policyState: PolicyState = { sessionGrants: new Set<PermissionCategory>(), turnGrants: new Set<PermissionCategory>() }
  readonly broker: PermissionBroker
  private voiceMode = false
  private disposed = false

  constructor(private readonly deps: SdkBackendDeps) {
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
  }

  onEvent(listener: (event: AgentUiEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(e: AgentUiEvent): void {
    if (e.type === 'result') this.totalCost = e.result.totalCostUsd
    if (e.type === 'result') this.policyState.turnGrants.clear()
    if (e.type === 'session') this.selectedSessionId = e.sessionId
    for (const l of this.listeners) l(e)
  }

  async start(): Promise<void> {
    const s = this.deps.getSettings()
    if (s.agent.continueLastSession) {
      try {
        const [last] = await listSessions({ dir: this.deps.cwd(), limit: 1 })
        if (last) {
          this.selectedSessionId = last.sessionId
          this.selectedTitle = last.customTitle ?? last.summary
          const messages = await this.loadHistory(last.sessionId)
          this.emit({ type: 'session', sessionId: last.sessionId, state: 'idle', title: this.selectedTitle })
          this.emit({ type: 'history', messages })
          return
        }
      } catch (err) {
        log.warn('could not restore last session', err)
      }
    }
    this.emit({ type: 'state', state: 'idle' })
  }

  getState(): AgentStateSnapshot {
    return {
      sessionId: this.session?.sessionId ?? this.selectedSessionId,
      state: this.session?.state ?? 'idle',
      model: this.session?.model ?? (this.deps.getSettings().agent.model || null),
      title: this.selectedTitle,
      totalCostUsd: this.totalCost,
    }
  }

  private async buildOptions(resume: string | undefined): Promise<Options> {
    const settings = this.deps.getSettings()
    const extraEnv = await this.deps.getExtraEnv()
    return buildOptions({
      settings,
      cwd: this.deps.cwd(),
      homeDir: this.deps.homeDir,
      memoryFile: this.deps.memoryFile(),
      claudeConfigDir: this.deps.claudeConfigDir,
      extraEnv,
      claudeBinary: this.deps.claudeBinary,
      appVersion: app.getVersion(),
      allowedTools: autoAllowedTools(settings.permissions),
      alwaysAllowRules: settings.permissions.alwaysAllowRules,
      mcpServers: this.deps.mcpServers?.(),
      canUseTool: this.broker.canUseTool,
      resume,
      voiceMode: this.voiceMode,
      isolateConfig: this.deps.isolateConfig(),
      debugFile: this.deps.debugFile?.(),
      stderr: (line) => {
        if (line.trim()) log.debug('[claude]', line.trimEnd())
      },
    })
  }

  private async ensureSession(): Promise<AgentSession> {
    if (this.session?.isAlive) return this.session
    if (this.starting) return this.starting
    this.starting = (async () => {
      const options = await this.buildOptions(this.selectedSessionId ?? undefined)
      const session = new AgentSession({ options, queryFn: query, emit: (e) => this.emit(e), log })
      this.session = session
      this.emit({ type: 'state', state: 'starting' })
      try {
        await session.start()
        if (session.sessionId) this.selectedSessionId = session.sessionId
        void session.supportedModels().then((m) => {
          if (m.length) this.cachedModels = m
        })
        return session
      } catch (err) {
        this.session = null
        throw err
      } finally {
        this.starting = null
      }
    })()
    return this.starting
  }

  async send(args: SendArgs): Promise<{ messageId: string }> {
    if (this.disposed) throw new Error('agent backend is disposed')
    this.voiceMode = !!args.fromVoice
    let session: AgentSession
    try {
      session = await this.ensureSession()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ type: 'error', error: makeError('startup_failed', message) })
      throw err
    }
    return session.send(args)
  }

  async interrupt(): Promise<void> {
    this.broker.cancelAll()
    await this.session?.interrupt()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.stopSession()
  }

  private async stopSession(): Promise<void> {
    this.broker.cancelAll()
    const s = this.session
    this.session = null
    await s?.dispose()
  }

  async newSession(): Promise<void> {
    await this.stopSession()
    this.selectedSessionId = null
    this.selectedTitle = null
    this.totalCost = 0
    this.policyState.sessionGrants.clear()
    this.policyState.turnGrants.clear()
    this.emit({ type: 'session', sessionId: '', state: 'idle', title: undefined })
    this.emit({ type: 'history', messages: [] })
  }

  async listSessions(): Promise<SessionSummary[]> {
    try {
      const list = await listSessions({ dir: this.deps.cwd(), limit: 100 })
      return list.map((s) => ({ sessionId: s.sessionId, title: s.customTitle ?? s.summary ?? '', lastModified: s.lastModified, firstPrompt: s.firstPrompt }))
    } catch (err) {
      log.warn('listSessions failed', err)
      return []
    }
  }

  private async loadHistory(sessionId: string): Promise<UiMessage[]> {
    const entries = await getSessionMessages(sessionId, { dir: this.deps.cwd(), includeSystemMessages: false })
    return historyToUi(entries)
  }

  async resumeSession(sessionId: string): Promise<UiMessage[]> {
    if (this.session?.sessionId === sessionId && this.session.isAlive) return this.loadHistory(sessionId)
    await this.stopSession()
    this.selectedSessionId = sessionId
    this.policyState.sessionGrants.clear()
    const messages = await this.loadHistory(sessionId)
    const [info] = (await this.listSessions()).filter((s) => s.sessionId === sessionId)
    this.selectedTitle = info?.title ?? null
    this.emit({ type: 'session', sessionId, state: 'idle', title: this.selectedTitle ?? undefined })
    return messages
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await renameSession(sessionId, title, { dir: this.deps.cwd() })
    if (sessionId === this.selectedSessionId) this.selectedTitle = title
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.session?.sessionId === sessionId) await this.newSession()
    await deleteSession(sessionId, { dir: this.deps.cwd() })
  }

  async listModels(): Promise<{ id: string; name: string; description?: string }[]> {
    if (this.session?.isAlive) {
      const live = await this.session.supportedModels().catch(() => [])
      if (live.length) this.cachedModels = live
    }
    return this.cachedModels.length ? this.cachedModels : FALLBACK_MODELS
  }

  async accountInfo(): Promise<{ email?: string; organization?: string; subscriptionType?: string } | null> {
    return this.session?.accountInfo() ?? null
  }

  /** Restart the live process so new env/settings (auth, proxy, model) take effect. */
  async restart(): Promise<void> {
    await this.stopSession()
    this.emit({ type: 'state', state: 'idle' })
  }
}
