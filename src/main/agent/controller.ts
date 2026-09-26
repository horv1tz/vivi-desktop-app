import { app } from 'electron'
import { join } from 'node:path'
import type { AgentUiEvent } from '@shared/events'
import type { SendArgs } from '@shared/ipc'
import type { AgentBackend } from './backend'
import { MockBackend } from './mock-backend'
import { SdkBackend } from './sdk-backend'
import { AcpBackend } from './acp-backend'
import { handle } from '../ipc/handlers'
import { emit } from '../ipc/emitters'
import { logger } from '../logging/log'
import { settings } from '../settings/store'
import { paths } from '../util/paths'
import { resolveClaudeBinary } from '../util/claude-bin'
import { resolveAcpAdapterEntry, resolveAcpBootstrap } from '../util/acp-adapter'
import { getMainWindow, showMainWindow } from '../app/windows'
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
}

/**
 * Owns the active AgentBackend (mock / Agent SDK / ACP), forwards its events to renderers and
 * exposes the agent IPC surface. The backend kind follows settings.agent.backend.
 */
export class AgentController {
  private backend: AgentBackend
  private unsubscribe: (() => void) | null = null

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
      log,
    })
  }

  private brokerUi(): BrokerUi {
    return {
      requestPermission: (req) => {
        emit('permission:request', req)
        if (!getMainWindow()?.isVisible()) showMainWindow()
      },
      resolvePermission: (requestId) => emit('permission:resolved', { requestId }),
      requestQuestion: (req) => {
        emit('question:request', req)
        if (!getMainWindow()?.isVisible()) showMainWindow()
      },
      resolveQuestion: (requestId) => emit('question:resolved', { requestId }),
    }
  }

  private createBackend(): AgentBackend {
    const kind = this.desiredKind()
    if (kind === 'mock') return new MockBackend()
    const common = {
      getSettings: () => settings().get(),
      updateSettings: (patch: { permissions: { alwaysAllowRules: { toolName: string; ruleContent?: string }[] } }) => {
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
      debugFile: () => (settings().get().features.debugSdk ? `${paths.logsDir}/claude-debug.log` : undefined),
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
      emit('agent:event', e)
      for (const l of this.eventListeners) l(e)
    })
    await this.backend.start()
  }

  send(args: SendArgs): Promise<{ messageId: string }> {
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

  private restarting: Promise<void> = Promise.resolve()

  /** Restart the agent process so changed auth/proxy/model settings apply; swaps the backend kind if it changed. */
  restart(): Promise<void> {
    // Serialized: overlapping restarts (auth change + settings change) must not race each other.
    this.restarting = this.restarting.then(() => this.doRestart()).catch((err) => log.warn('agent restart failed', err))
    return this.restarting
  }

  private async doRestart(): Promise<void> {
    const desired = this.desiredKind()
    if (desired !== this.backend.kind) {
      log.info(`switching agent backend ${this.backend.kind} → ${desired}`)
      const old = this.backend
      this.unsubscribe?.()
      // Swap first so sends arriving during the old backend's teardown reach the new one.
      this.backend = this.createBackend()
      await old.dispose().catch((err) => log.warn('backend dispose failed', err))
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
    handle('agent:send', (_e, args) => this.backend.send(args))
    handle('agent:interrupt', () => this.backend.interrupt())
    handle('agent:getState', () => this.backend.getState())
    handle('agent:newSession', () => this.backend.newSession())
    handle('agent:listSessions', () => this.backend.listSessions())
    handle('agent:resumeSession', (_e, id) => this.backend.resumeSession(id))
    handle('agent:renameSession', (_e, id, title) => this.backend.renameSession(id, title))
    handle('agent:deleteSession', (_e, id) => this.backend.deleteSession(id))
    handle('agent:listModels', () => this.backend.listModels())
    handle('permission:respond', (_e, requestId, decision) => this.backend.broker?.respond(requestId, decision))
    handle('question:respond', (_e, requestId, answers) => this.backend.broker?.answerQuestion(requestId, answers))
    app.on('will-quit', () => void this.dispose())
  }
}
