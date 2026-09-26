import type { AgentStateSnapshot, SendArgs } from '@shared/ipc'
import type { AgentUiEvent, SessionSummary, UiMessage } from '@shared/events'

/**
 * Abstraction over the agent implementation so the UI can be developed and tested
 * with a deterministic mock (VIVI_MOCK_AGENT=1) and run against the Claude Agent SDK otherwise.
 */
export interface AgentBackend {
  readonly kind: 'mock' | 'sdk'
  start(): Promise<void>
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
