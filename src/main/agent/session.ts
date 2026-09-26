import { randomUUID } from 'node:crypto'
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentUiEvent, SessionState, UiBlock, UiMessage } from '@shared/events'
import type { SendArgs } from '@shared/ipc'
import { AsyncQueue } from './async-queue'
import { SessionReducer, makeError } from './reducer'

export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => Query

export interface AgentSessionDeps {
  options: Options
  queryFn: QueryFn
  emit: (event: AgentUiEvent) => void
  log?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void; debug: (...a: unknown[]) => void }
  initTimeoutMs?: number
  stderrTailSize?: number
}

/**
 * One live Claude Code process in streaming-input mode.
 * States: starting → idle ⇄ running (→ awaiting_*) ; closing → closed | failed.
 */
export class AgentSession {
  readonly id = randomUUID()
  private readonly queue = new AsyncQueue<SDKUserMessage>()
  private readonly abort = new AbortController()
  private readonly reducer: SessionReducer
  private readonly stderrTail: string[] = []
  private query: Query | null = null
  private pumpPromise: Promise<void> | null = null
  private started = false
  private disposed = false
  private _state: SessionState = 'starting'
  private endedReason: string | null = null
  private pendingUserMessages = new Map<string, UiMessage>()

  constructor(private readonly deps: AgentSessionDeps) {
    this.reducer = new SessionReducer({
      emit: (e) => {
        if (e.type === 'state') this._state = e.state
        if (e.type === 'session') this._state = e.state
        deps.emit(e)
      },
    })
  }

  get state(): SessionState {
    return this._state
  }

  private readState(): SessionState {
    return this._state
  }

  get sessionId(): string | null {
    return this.reducer.sessionId
  }

  get model(): string | null {
    return this.reducer.model
  }

  get isAlive(): boolean {
    return this.started && !this.disposed && this._state !== 'closed' && this._state !== 'failed'
  }

  get lastStderr(): string {
    return this.stderrTail.join('\n')
  }

  /** Spawns the CLI and starts consuming its message stream. Resolves once the init handshake completes. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const options: Options = {
      ...this.deps.options,
      abortController: this.abort,
      stderr: (line: string) => {
        this.stderrTail.push(line.trimEnd())
        if (this.stderrTail.length > (this.deps.stderrTailSize ?? 200)) this.stderrTail.shift()
        this.deps.options.stderr?.(line)
      },
    }
    this.query = this.deps.queryFn({ prompt: this.queue, options })
    this.pumpPromise = this.pump(this.query)
    const timeoutMs = this.deps.initTimeoutMs ?? 45_000
    const init = this.query.initializationResult().then(() => 'ok' as const)
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs))
    const ended = this.pumpPromise.then(() => 'ended' as const)
    const outcome = await Promise.race([init, timeout, ended])
    if (outcome === 'ok') return
    if (outcome === 'timeout') {
      this.deps.log?.error('agent init timeout', this.lastStderr)
      this.deps.emit({ type: 'error', error: makeError('startup_failed', `Claude Code did not initialize within ${Math.round(timeoutMs / 1000)}s\n${this.lastStderr}`) })
      await this.dispose()
      throw new Error('agent init timeout')
    }
    throw new Error(this.endedReason ?? 'agent process ended during startup')
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        this.reducer.handle(msg)
      }
      this.endedReason = this.disposed ? 'disposed' : 'stream ended'
      this.finish(this.disposed ? 'closed' : 'closed')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.endedReason = message
      if (this.disposed || this.abort.signal.aborted) {
        this.finish('closed')
        return
      }
      this.deps.log?.error('agent process error', message, this.lastStderr)
      this.deps.emit({ type: 'error', error: makeError('process_exited', `${message}\n${this.lastStderr}`.trim()) })
      this.finish('failed')
    }
  }

  private finish(state: 'closed' | 'failed'): void {
    this.reducer.dispose()
    if (this._state !== state) {
      this._state = state
      this.deps.emit({ type: 'state', state })
    }
  }

  static userMessageFromArgs(args: SendArgs): { sdk: SDKUserMessage; ui: UiMessage } {
    const uuid = randomUUID()
    const blocks: UiBlock[] = []
    const content: ({ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string } })[] = []
    if (args.text.trim()) {
      content.push({ type: 'text', text: args.text })
      blocks.push({ type: 'text', text: args.text })
    }
    for (const img of args.images ?? []) {
      const media = (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(img.mimeType) ? img.mimeType : 'image/png') as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
      content.push({ type: 'image', source: { type: 'base64', media_type: media, data: img.data } })
      blocks.push({ type: 'image', mimeType: media, data: img.data })
    }
    const sdk: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: content.length === 1 && content[0]?.type === 'text' ? content[0].text : content },
      parent_tool_use_id: null,
      uuid: uuid as SDKUserMessage['uuid'],
    }
    const ui: UiMessage = { id: uuid, role: 'user', blocks, timestamp: Date.now() }
    return { sdk, ui }
  }

  async send(args: SendArgs): Promise<{ messageId: string }> {
    if (!this.isAlive) throw new Error('agent session is not running')
    const { sdk, ui } = AgentSession.userMessageFromArgs(args)
    this.pendingUserMessages.set(ui.id, ui)
    this.deps.emit({ type: 'user-message', message: ui })
    if (!this.queue.push(sdk)) throw new Error('agent input closed')
    return { messageId: ui.id }
  }

  async interrupt(): Promise<void> {
    if (!this.query || !this.isAlive) return
    try {
      await this.query.interrupt()
    } catch (err) {
      this.deps.log?.warn('interrupt failed', err)
    }
  }

  async setModel(model?: string): Promise<void> {
    await this.query?.setModel(model)
  }

  async setPermissionMode(mode: Options['permissionMode'] & string): Promise<void> {
    await this.query?.setPermissionMode(mode)
  }

  async supportedModels(): Promise<{ id: string; name: string; description?: string }[]> {
    if (!this.query || !this.isAlive) return []
    const models = await this.query.supportedModels()
    return models.map((m) => ({ id: m.value, name: m.displayName, description: m.description }))
  }

  async accountInfo(): Promise<Awaited<ReturnType<Query['accountInfo']>> | null> {
    if (!this.query || !this.isAlive) return null
    try {
      return await this.query.accountInfo()
    } catch {
      return null
    }
  }

  /** Graceful shutdown: close input (CLI exits after the current turn) then abort as a fallback. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this._state = 'closing'
    this.deps.emit({ type: 'state', state: 'closing' })
    this.queue.end()
    const q = this.query
    const graceful = this.pumpPromise ?? Promise.resolve()
    const timer = new Promise<void>((r) => setTimeout(r, 2500))
    await Promise.race([graceful, timer])
    const current = this.readState()
    if (current !== 'closed' && current !== 'failed') {
      this.abort.abort()
      try {
        q?.close()
      } catch {
        /* already closed */
      }
      await Promise.race([graceful, new Promise<void>((r) => setTimeout(r, 1500))])
      this.finish('closed')
    }
  }
}
