import { app } from 'electron'
import type { AgentUiEvent } from '@shared/events'
import type { SendArgs } from '@shared/ipc'
import type { AgentBackend } from './backend'
import { MockBackend } from './mock-backend'
import { SdkBackend } from './sdk-backend'
import { handle } from '../ipc/handlers'
import { emit } from '../ipc/emitters'
import { logger } from '../logging/log'
import { settings } from '../settings/store'
import { paths } from '../util/paths'
import { resolveClaudeBinary } from '../util/claude-bin'
import { getMainWindow, showMainWindow } from '../app/windows'
import { createViviMcpServer } from './tools'
import type { InputDriver } from './tools/input-driver'

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
 * Owns the active AgentBackend, forwards its events to renderers and exposes the agent IPC surface.
 */
export class AgentController {
  private backend: AgentBackend
  private unsubscribe: (() => void) | null = null

  constructor(private readonly deps: ControllerDeps) {
    this.backend = this.createBackend()
  }

  get sdk(): SdkBackend | null {
    return this.backend instanceof SdkBackend ? this.backend : null
  }

  private createBackend(): AgentBackend {
    if (this.deps.mock) return new MockBackend()
    return new SdkBackend({
      getSettings: () => settings().get(),
      updateSettings: (patch) => {
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
      mcpServers: () => ({
        vivi: createViviMcpServer({
          memoryFile: () => paths.memoryFile(paths.workspace(settings().get().agent.workspaceDir)),
          speak: this.deps.speak,
          stopSpeaking: this.deps.stopSpeaking,
          inputDriver: this.deps.inputDriver,
          beforeInputAction: this.deps.beforeInputAction,
          appRegistryEnabled: () => settings().get().features.appRegistry,
          log,
        }),
      }),
      ui: {
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
      },
    })
  }

  async start(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = this.backend.onEvent((e: AgentUiEvent) => emit('agent:event', e))
    await this.backend.start()
  }

  send(args: SendArgs): Promise<{ messageId: string }> {
    return this.backend.send(args)
  }

  onEvent(listener: (e: AgentUiEvent) => void): () => void {
    return this.backend.onEvent(listener)
  }

  async killSwitch(): Promise<void> {
    log.warn('kill switch triggered')
    await this.backend.interrupt()
  }

  /** Restart the CLI process so changed auth/proxy/model settings apply. */
  async restart(): Promise<void> {
    await this.sdk?.restart()
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
    handle('permission:respond', (_e, requestId, decision) => this.sdk?.broker.respond(requestId, decision))
    handle('question:respond', (_e, requestId, answers) => this.sdk?.broker.answerQuestion(requestId, answers))
    app.on('will-quit', () => void this.dispose())
  }
}
