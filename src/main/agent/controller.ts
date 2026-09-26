import type { AgentUiEvent } from '@shared/events'
import type { AgentBackend } from './backend'
import { MockBackend } from './mock-backend'
import { handle } from '../ipc/handlers'
import { emit } from '../ipc/emitters'
import { logger } from '../logging/log'

const log = logger('agent')

/**
 * Owns the active AgentBackend, forwards its events to renderers and exposes the agent IPC surface.
 * Phase 2 adds the SDK-backed implementation; the controller stays the single entry point.
 */
export class AgentController {
  private backend: AgentBackend
  private unsubscribe: (() => void) | null = null

  constructor(private readonly opts: { mock: boolean }) {
    this.backend = this.createBackend()
  }

  private createBackend(): AgentBackend {
    if (this.opts.mock) return new MockBackend()
    // SDK backend is wired in Phase 2; until then fall back to the mock so the app is always usable.
    return new MockBackend()
  }

  async start(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = this.backend.onEvent((e: AgentUiEvent) => emit('agent:event', e))
    await this.backend.start()
  }

  async killSwitch(): Promise<void> {
    log.warn('kill switch triggered')
    await this.backend.interrupt()
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
  }
}
