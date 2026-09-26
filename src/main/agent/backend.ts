import type { AgentStateSnapshot, SendArgs } from '@shared/ipc'
import type { AgentUiEvent, SessionSummary, UiMessage } from '@shared/events'
import type { PermissionBroker } from './permissions/broker'

/**
 * Abstraction over the agent implementation so the UI can be developed and tested
 * with a deterministic mock (VIVI_MOCK_AGENT=1) and run against the Claude Agent SDK otherwise.
 */
export interface AgentBackend {
  readonly kind: 'mock' | 'sdk' | 'acp'
  /** Permission/question dialogs are answered through the broker (absent for the mock). */
  readonly broker?: PermissionBroker
  start(): Promise<void>
  /** Tear down the live agent process so changed auth/proxy/model settings apply on next send. */
  restart(): Promise<void>
  send(args: SendArgs): Promise<{ messageId: string }>
  interrupt(): Promise<void>
  dispose(): Promise<void>
  getState(): AgentStateSnapshot
  newSession(): Promise<void>
  listSessions(): Promise<SessionSummary[]>
  resumeSession(sessionId: string): Promise<UiMessage[]>
  renameSession(sessionId: string, title: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  listModels(): Promise<{ id: string; name: string; description?: string }[]>
  onEvent(listener: (event: AgentUiEvent) => void): () => void
}
