import { app, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentUiEvent,
  PermissionDecision,
  PermissionRequest,
  QuestionRequest,
} from '@shared/events'
import type { SendArgs } from '@shared/ipc'
import type { Settings } from '@shared/settings'
import type { AgentBackend } from './backend'
import { MockBackend } from './mock-backend'
import { SdkBackend } from './sdk-backend'
import { AcpBackend } from './acp-backend'
import { ActionJournal } from './journal'
import { MetricsStore } from './metrics'
import { handle } from '../ipc/handlers'
import { emit } from '../ipc/emitters'
import { logger } from '../logging/log'
import { settings } from '../settings/store'
import { paths } from '../util/paths'
import { resolveClaudeBinary } from '../util/claude-bin'
import { resolveAcpAdapterEntry, resolveAcpBootstrap } from '../util/acp-adapter'
import { getMainWindow, showMainWindow, withOwnWindowsHidden } from '../app/windows'
import { createViviMcpServer } from './tools'
import type { InputDriver } from './tools/input-driver'
import type { BrokerUi } from './permissions/broker'

const log = logger('agent')

export interface ControllerDeps {
  mock: boolean
  getExtraEnv: () => Promise<Record<string, string | undefined>>
  isolateConfig: () => boolean
  speak: (text: string) => Promise<void>
  stopSpeaking: () => Promise<void>
  inputDriver: () => Promise<InputDriver | null>
  beforeInputAction?: () => Promise<void>
  /** CU-07: called whenever the user explicitly sends the agent a new message (text or voice). */
  onUserAction?: () => void
}

/**
 * Owns the active AgentBackend (mock / Agent SDK / ACP), forwards its events to renderers and
 * exposes the agent IPC surface. The backend kind follows settings.agent.backend.
 */
export class AgentController {
  private backend: AgentBackend
  private unsubscribe: (() => void) | null = null
  private journal = new ActionJournal(paths.journalFile)
  private metrics = new MetricsStore(paths.metricsFile)

  constructor(private readonly deps: ControllerDeps) {
    this.backend = this.createBackend()
  }

  get kind(): AgentBackend['kind'] {
    return this.backend.kind
  }

  get sdk(): SdkBackend | null {
    return this.backend instanceof SdkBackend ? this.backend : null
  }

  private desiredKind(): AgentBackend['kind'] {
    if (this.deps.mock) return 'mock'
    return settings().get().agent.backend === 'acp' ? 'acp' : 'sdk'
  }

  private viviTools() {
    return createViviMcpServer({
      memoryFile: () => paths.memoryFile(paths.workspace(settings().get().agent.workspaceDir)),
      speak: this.deps.speak,
      stopSpeaking: this.deps.stopSpeaking,
      inputDriver: this.deps.inputDriver,
      beforeInputAction: this.deps.beforeInputAction,
      appRegistryEnabled: () => settings().get().features.appRegistry,
      withOwnWindowsHidden,
      screenshotFormat: () => settings().get().agent.screenshotFormat,
      screenshotQuality: () => settings().get().agent.screenshotQuality,
      log,
    })
  }

  private permissionListeners = new Set<(req: PermissionRequest) => void>()
  private permissionResolvedListeners = new Set<(requestId: string) => void>()
  private questionListeners = new Set<(req: QuestionRequest) => void>()
  private questionResolvedListeners = new Set<(requestId: string) => void>()

  /** VO-05: lets the voice orchestrator speak a permission/question prompt and answer it by voice. */
  onPermissionRequest(listener: (req: PermissionRequest) => void): () => void {
    this.permissionListeners.add(listener)
    return () => this.permissionListeners.delete(listener)
  }
  onPermissionResolved(listener: (requestId: string) => void): () => void {
    this.permissionResolvedListeners.add(listener)
    return () => this.permissionResolvedListeners.delete(listener)
  }
  onQuestionRequest(listener: (req: QuestionRequest) => void): () => void {
    this.questionListeners.add(listener)
    return () => this.questionListeners.delete(listener)
  }
  onQuestionResolved(listener: (requestId: string) => void): () => void {
    this.questionResolvedListeners.add(listener)
    return () => this.questionResolvedListeners.delete(listener)
  }
  respondPermission(requestId: string, decision: PermissionDecision): void {
    this.backend.broker?.respond(requestId, decision)
  }
  answerQuestionRequest(requestId: string, answers: Record<string, string>): void {
    this.backend.broker?.answerQuestion(requestId, answers)
  }

  private brokerUi(): BrokerUi {
    return {
      requestPermission: (req) => {
        emit('permission:request', req)
        for (const l of this.permissionListeners) l(req)
        if (!getMainWindow()?.isVisible()) showMainWindow()
      },
      resolvePermission: (requestId) => {
        emit('permission:resolved', { requestId })
        for (const l of this.permissionResolvedListeners) l(requestId)
      },
      requestQuestion: (req) => {
        emit('question:request', req)
        for (const l of this.questionListeners) l(req)
        if (!getMainWindow()?.isVisible()) showMainWindow()
      },
      resolveQuestion: (requestId) => {
        emit('question:resolved', { requestId })
        for (const l of this.questionResolvedListeners) l(requestId)
      },
    }
  }

  private createBackend(): AgentBackend {
    const kind = this.desiredKind()
    if (kind === 'mock') return new MockBackend()
    const common = {
      getSettings: () => settings().get(),
      updateSettings: (patch: {
        permissions: { alwaysAllowRules: { toolName: string; ruleContent?: string }[] }
      }) => {
        settings().update(patch)
        emit('settings:changed', settings().get())
      },
      getExtraEnv: this.deps.getExtraEnv,
      isolateConfig: this.deps.isolateConfig,
      cwd: () => paths.workspace(settings().get().agent.workspaceDir),
      homeDir: paths.home,
      memoryFile: () => paths.memoryFile(paths.workspace(settings().get().agent.workspaceDir)),
      claudeConfigDir: paths.claudeConfigDir,
      claudeBinary: resolveClaudeBinary(),
      debugFile: () =>
        settings().get().features.debugSdk ? `${paths.logsDir}/claude-debug.log` : undefined,
      ui: this.brokerUi(),
    }
    if (kind === 'acp') {
      return new AcpBackend({
        ...common,
        adapterEntry: resolveAcpAdapterEntry,
        adapterBootstrap: resolveAcpBootstrap,
        createMcpServer: () => this.viviTools().instance,
        appVersion: app.getVersion(),
        titlesFile: join(paths.userData, 'acp-session-titles.json'),
        log,
      })
    }
    return new SdkBackend({
      ...common,
      mcpServers: () => ({ vivi: this.viviTools() }),
    })
  }

  async start(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = this.backend.onEvent((e: AgentUiEvent) => {
      this.journal.record(e)
      this.metrics.record(e)
      emit('agent:event', e)
      for (const l of this.eventListeners) l(e)
    })
    await this.backend.start()
  }

  send(args: SendArgs): Promise<{ messageId: string }> {
    this.deps.onUserAction?.()
    return this.backend.send(args)
  }

  private eventListeners = new Set<(e: AgentUiEvent) => void>()

  /** Subscribe through the controller so listeners (voice) survive a backend swap. */
  onEvent(listener: (e: AgentUiEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  async killSwitch(): Promise<void> {
    log.warn('kill switch triggered')
    await this.backend.interrupt()
  }

  /** AG-05: passthrough to the live backend; see AgentBackend.applyLiveModelAndMode. */
  applyLiveModelAndMode(previous: Settings, next: Settings): Promise<boolean> {
    return this.backend.applyLiveModelAndMode(previous, next)
  }

  private restarting: Promise<void> = Promise.resolve()

  /** Restart the agent process so changed auth/proxy/model settings apply; swaps the backend kind if it changed. */
  restart(): Promise<void> {
    // Serialized: overlapping restarts (auth change + settings change) must not race each other.
    this.restarting = this.restarting
      .then(() => this.doRestart())
      .catch((err) => log.warn('agent restart failed', err))
    return this.restarting
  }

  private async doRestart(): Promise<void> {
    const desired = this.desiredKind()
    if (desired !== this.backend.kind) {
      log.info(`switching agent backend ${this.backend.kind} → ${desired}`)
      const old = this.backend
      this.unsubscribe?.()
      // The old backend may still be finishing a turn: keep its content events flowing (so the
      // renderer settles), but not its state/session events, which would fight the new backend's.
      const tap = old.onEvent((e) => {
        if (e.type === 'state' || e.type === 'session' || e.type === 'history') return
        this.journal.record(e)
        this.metrics.record(e)
        emit('agent:event', e)
        for (const l of this.eventListeners) l(e)
      })
      // Swap first so sends arriving during the old backend's teardown reach the new one.
      this.backend = this.createBackend()
      try {
        await old.dispose()
      } catch (err) {
        log.warn('backend dispose failed', err)
      } finally {
        tap()
      }
      await this.start()
      return
    }
    await this.backend.restart()
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.()
    await this.backend.dispose()
  }

  registerIpc(): void {
    handle('agent:send', (_e, args) => this.send(args))
    handle('agent:interrupt', () => this.backend.interrupt())
    handle('agent:getState', () => this.backend.getState())
    handle('agent:newSession', () => this.backend.newSession())
    handle('agent:listSessions', () => this.backend.listSessions())
    handle('agent:resumeSession', (_e, id) => this.backend.resumeSession(id))
    handle('agent:renameSession', (_e, id, title) => this.backend.renameSession(id, title))
    handle('agent:deleteSession', (_e, id) => this.backend.deleteSession(id))
    handle('agent:listModels', () => this.backend.listModels())
    handle('permission:respond', (_e, requestId, decision) =>
      this.respondPermission(requestId, decision),
    )
    handle('question:respond', (_e, requestId, answers) =>
      this.answerQuestionRequest(requestId, answers),
    )
    handle('journal:list', () => this.journal.list())
    handle('journal:clear', () => this.journal.clear())
    handle('journal:export', async () => {
      const win = getMainWindow()
      const defaultPath = join(
        app.getPath('desktop'),
        `vivi-journal-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      )
      const opts = { defaultPath, filters: [{ name: 'JSON', extensions: ['json'] }] }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return null
      writeFileSync(res.filePath, JSON.stringify(this.journal.list(), null, 2), 'utf8')
      return res.filePath
    })
    handle('metrics:summary', () => this.metrics.summary())
    handle('metrics:clear', () => this.metrics.clear())
    handle('metrics:exportCsv', async () => {
      const win = getMainWindow()
      const defaultPath = join(
        app.getPath('desktop'),
        `vivi-usage-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
      )
      const opts = { defaultPath, filters: [{ name: 'CSV', extensions: ['csv'] }] }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return null
      writeFileSync(res.filePath, this.metrics.toCsv(), 'utf8')
      return res.filePath
    })
    app.on('will-quit', () => void this.dispose())
  }
}
