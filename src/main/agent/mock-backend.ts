import { randomUUID } from 'node:crypto'
import type { AgentStateSnapshot, SendArgs } from '@shared/ipc'
import type { AgentUiEvent, SessionState, SessionSummary, UiMessage, UiToolUseBlock } from '@shared/events'
import type { AgentBackend } from './backend'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Deterministic fake agent used for UI development, e2e tests and screenshots. */
export class MockBackend implements AgentBackend {
  readonly kind = 'mock' as const
  private listeners = new Set<(e: AgentUiEvent) => void>()
  private state: SessionState = 'idle'
  private sessionId: string = randomUUID()
  private aborted = false
  private totalCost = 0
  private history: UiMessage[] = []
  private sessions: SessionSummary[] = []

  async start(): Promise<void> {
    this.emit({ type: 'session', sessionId: this.sessionId, state: 'idle', model: 'mock-model', tools: ['Read', 'Bash'] })
  }

  onEvent(listener: (event: AgentUiEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(e: AgentUiEvent): void {
    for (const l of this.listeners) l(e)
  }

  private setState(state: SessionState): void {
    this.state = state
    this.emit({ type: 'state', state })
  }

  getState(): AgentStateSnapshot {
    return { sessionId: this.sessionId, state: this.state, model: 'mock-model', title: 'Mock session', totalCostUsd: this.totalCost }
  }

  async send(args: SendArgs): Promise<{ messageId: string }> {
    const userId = randomUUID()
    const userMsg: UiMessage = { id: userId, role: 'user', blocks: [{ type: 'text', text: args.text }], timestamp: Date.now() }
    this.history.push(userMsg)
    this.emit({ type: 'user-message', message: userMsg })
    void this.runTurn(args)
    return { messageId: userId }
  }

  private async runTurn(args: SendArgs): Promise<void> {
    this.aborted = false
    this.setState('running')
    const started = Date.now()
    const messageId = randomUUID()
    this.emit({ type: 'assistant-start', messageId, parentToolUseId: null })

    const lower = args.text.toLowerCase()
    const useTool = /файл|file|папк|folder|list|покажи|скриншот|screenshot/.test(lower)
    let blockIndex = 0
    const blocks: UiMessage['blocks'] = []

    const streamText = async (text: string): Promise<void> => {
      const words = text.split(/(\s+)/)
      let acc = ''
      for (const w of words) {
        if (this.aborted) return
        acc += w
        this.emit({ type: 'text-delta', messageId, blockIndex, text: w, kind: 'text' })
        await sleep(18)
      }
      blocks.push({ type: 'text', text: acc })
      blockIndex++
    }

    if (useTool) {
      await streamText(args.fromVoice ? 'Смотрю, что есть в папке.' : 'Сейчас посмотрю содержимое рабочей папки.')
      const tool: UiToolUseBlock = { type: 'tool_use', toolUseId: randomUUID(), name: 'Bash', input: { command: 'ls -la ~/Vivi' } }
      blocks.push(tool)
      blockIndex++
      this.emit({ type: 'tool-use', messageId, block: tool, parentToolUseId: null })
      await sleep(600)
      if (this.aborted) return this.finish(messageId, blocks, started, true)
      const result = { content: 'total 3\nnotes.md\nmemory/\nprojects/', isError: false, durationMs: 590 }
      tool.result = result
      this.emit({ type: 'tool-result', toolUseId: tool.toolUseId, result })
      await streamText('В папке ~/Vivi три элемента: notes.md, memory/ и projects/. Что с ними сделать?')
    } else {
      await streamText(
        args.fromVoice
          ? 'Готово. Это ответ mock-агента на голосовую команду — настоящий Claude подключится после авторизации.'
          : `Это mock-агент. Вы написали: «${args.text}». Подключите Claude в настройках, чтобы получить настоящие ответы, включая работу с файлами, поиск в интернете и управление программами.`,
      )
    }
    this.finish(messageId, blocks, started, this.aborted)
  }

  private finish(messageId: string, blocks: UiMessage['blocks'], started: number, interrupted: boolean): void {
    const message: UiMessage = { id: messageId, role: 'assistant', blocks, timestamp: Date.now() }
    this.history.push(message)
    this.emit({ type: 'assistant-message', message })
    const cost = 0.0042
    this.totalCost += cost
    this.emit({
      type: 'result',
      result: {
        turnId: messageId,
        subtype: interrupted ? 'interrupted' : 'success',
        isError: false,
        costUsd: cost,
        totalCostUsd: this.totalCost,
        durationMs: Date.now() - started,
        numTurns: 1,
        inputTokens: 1200,
        outputTokens: 180,
        cacheReadTokens: 900,
        cacheWriteTokens: 0,
        contextWindow: 200000,
      },
    })
    this.setState('idle')
  }

  async interrupt(): Promise<void> {
    this.aborted = true
  }

  async dispose(): Promise<void> {
    this.aborted = true
    this.setState('closed')
  }

  async restart(): Promise<void> {
    this.aborted = true
    this.setState('idle')
  }

  async newSession(): Promise<void> {
    if (this.history.length > 0) {
      this.sessions.unshift({ sessionId: this.sessionId, title: this.history[0]?.blocks[0]?.type === 'text' ? this.history[0].blocks[0].text.slice(0, 60) : 'Session', lastModified: Date.now() })
    }
    this.sessionId = randomUUID()
    this.history = []
    this.emit({ type: 'session', sessionId: this.sessionId, state: 'idle', model: 'mock-model' })
    this.emit({ type: 'history', messages: [] })
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.sessions
  }

  async resumeSession(sessionId: string): Promise<UiMessage[]> {
    this.sessionId = sessionId
    this.emit({ type: 'session', sessionId, state: 'idle', model: 'mock-model' })
    return this.history
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const s = this.sessions.find((x) => x.sessionId === sessionId)
    if (s) s.title = title
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions = this.sessions.filter((x) => x.sessionId !== sessionId)
  }

  async listModels(): Promise<{ id: string; name: string; description?: string }[]> {
    return [
      { id: 'claude-opus-5', name: 'Claude Opus 5', description: 'mock' },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', description: 'mock' },
    ]
  }
}
