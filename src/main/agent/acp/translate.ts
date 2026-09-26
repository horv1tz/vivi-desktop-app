import { randomUUID } from 'node:crypto'
import type { ContentBlock, PromptResponse, SessionNotification, SessionUpdate, ToolCallContent, ToolCallUpdate, ToolKind } from '@agentclientprotocol/sdk'
import type { AgentUiEvent, TurnResult, UiBlock, UiImageBlock, UiMessage, UiToolResult, UiToolUseBlock } from '@shared/events'

interface StreamingMessage {
  id: string
  blocks: UiBlock[]
  /** Text arriving after a tool call starts a new assistant message (mirrors API message boundaries). */
  afterTool: boolean
}

interface ToolState {
  messageId: string
  startedAt: number
  block: UiToolUseBlock
  done: boolean
  /** Latest non-empty content seen for the call (Edit/Write diffs arrive before the completion update). */
  content?: ToolCallContent[]
}

interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cachedReadTokens: number
  cachedWriteTokens: number
}

export interface TranslatorOptions {
  emit: (e: AgentUiEvent) => void
  now?: () => number
}

/** Claude-specific metadata the claude-agent-acp adapter attaches to tool calls. */
type ClaudeToolMeta = { claudeCode?: { toolName?: string; parentToolUseId?: string; subagent?: true } } | null | undefined

export function toolNameOf(call: { title?: string | null; name?: string | null; kind?: ToolKind | null; _meta?: unknown }): string {
  const meta = call._meta as ClaudeToolMeta
  return meta?.claudeCode?.toolName ?? call.name ?? call.title ?? call.kind ?? 'tool'
}

export function textOfContent(content: ContentBlock | undefined | null): string {
  if (!content) return ''
  switch (content.type) {
    case 'text':
      return content.text
    case 'resource_link':
      return content.uri
    case 'resource': {
      const r = content.resource as { text?: string; uri?: string }
      return r.text ?? r.uri ?? ''
    }
    default:
      return ''
  }
}

export function toolResultOf(update: ToolCallUpdate): UiToolResult {
  const parts: string[] = []
  const images: UiImageBlock[] = []
  for (const c of update.content ?? []) {
    const cc = c as ToolCallContent
    if (cc.type === 'content') {
      if (cc.content.type === 'image') images.push({ type: 'image', mimeType: cc.content.mimeType, data: cc.content.data })
      else parts.push(textOfContent(cc.content))
    } else if (cc.type === 'diff') {
      parts.push(`--- ${cc.path}\n${cc.oldText ? `- ${cc.oldText.split('\n').join('\n- ')}\n` : ''}+ ${cc.newText.split('\n').join('\n+ ')}`)
    } else if (cc.type === 'terminal') {
      parts.push(`[terminal ${cc.terminalId}]`)
    }
  }
  let content = parts.filter(Boolean).join('\n')
  if (!content && update.rawOutput !== undefined && update.rawOutput !== null) {
    content = typeof update.rawOutput === 'string' ? update.rawOutput : JSON.stringify(update.rawOutput, null, 2)
  }
  return { content, isError: update.status === 'failed', images: images.length ? images : undefined }
}

/**
 * Turns ACP `session/update` notifications into Vivi's UI event stream.
 * Pure and synchronous so it can be unit-tested without a process.
 *
 * Streaming mode (a live prompt): chunks are emitted as deltas; the assistant message is finalized
 * on `finishTurn`. Replay mode (`session/load`): the same notifications are folded into a history array.
 */
export class AcpTranslator {
  private readonly emit: (e: AgentUiEvent) => void
  private readonly now: () => number
  private streaming: StreamingMessage | null = null
  private tools = new Map<string, ToolState>()
  private toolCalls = 0
  private turnStartedAt = 0
  private usage: { used: number; size: number } | null = null
  private replay: UiMessage[] | null = null
  private replayUser: UiMessage | null = null

  constructor(opts: TranslatorOptions) {
    this.emit = opts.emit
    this.now = opts.now ?? (() => Date.now())
  }

  /** Context window usage as last reported by the agent. */
  get contextUsage(): { used: number; size: number } | null {
    return this.usage
  }

  beginTurn(): void {
    this.turnStartedAt = this.now()
    this.toolCalls = 0
    this.streaming = null
    this.tools.clear()
  }

  /** Start collecting replayed history instead of emitting live events. */
  beginReplay(): void {
    this.replay = []
    this.replayUser = null
    this.streaming = null
    this.tools.clear()
  }

  /** Finish replay and return the reconstructed conversation. */
  endReplay(): UiMessage[] {
    this.flushReplayUser()
    if (this.streaming) this.replay?.push(this.finalizeStreaming())
    const out = this.replay ?? []
    this.replay = null
    this.tools.clear()
    return out
  }

  /**
   * PromptResponse.usage is per prompt: claude-agent-acp resets its tally when a user turn activates
   * (`accumulatedUsage` in acp-agent.js) and the ACP spec defines usage per prompt request.
   */
  private turnUsage(usage: PromptResponse['usage'] | undefined): UsageTotals {
    return { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, cachedReadTokens: usage?.cachedReadTokens ?? 0, cachedWriteTokens: usage?.cachedWriteTokens ?? 0 }
  }

  handle(notification: SessionNotification): void {
    this.handleUpdate(notification.update)
  }

  handleUpdate(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        this.onUserChunk(update.content)
        break
      case 'agent_message_chunk':
        this.onAgentChunk(update.content, 'text')
        break
      case 'agent_thought_chunk':
        this.onAgentChunk(update.content, 'thinking')
        break
      case 'tool_call':
        this.onToolCall(update)
        break
      case 'tool_call_update':
        this.onToolCallUpdate(update)
        break
      case 'usage_update':
        this.usage = { used: update.used, size: update.size }
        break
      case 'compaction_update':
        if (!this.replay) this.emit({ type: 'compact' })
        break
      case 'notice':
        if (!this.replay) this.emit({ type: 'status', status: null, detail: `${update.title}${update.description ? `: ${update.description}` : ''}` })
        break
      default:
        // plan, available_commands_update, current_mode_update, config_option_update, session_info_update: not surfaced in the chat.
        break
    }
  }

  /** Finalize the assistant message of a live prompt and emit the turn result. */
  finishTurn(response: PromptResponse | null, opts: { turnId?: string; error?: boolean; totalCostUsd?: number } = {}): TurnResult {
    const message = this.streaming ? this.finalizeStreaming() : null
    if (message) this.emit({ type: 'assistant-message', message })
    // Tool calls that never completed (cancelled turn) get an empty result so the UI stops spinning.
    for (const [id, t] of this.tools) {
      if (!t.done) {
        t.done = true
        this.emit({ type: 'tool-result', toolUseId: id, result: { content: response?.stopReason === 'cancelled' ? 'Cancelled' : '', isError: response?.stopReason === 'cancelled' } })
      }
    }
    this.tools.clear()
    const stopReason = response?.stopReason ?? null
    const usage = this.turnUsage(response?.usage)
    const result: TurnResult = {
      turnId: opts.turnId ?? randomUUID(),
      subtype: stopReason === 'end_turn' ? 'success' : stopReason === 'max_turn_requests' ? 'error_max_turns' : stopReason ?? (opts.error ? 'error' : 'success'),
      isError: !!opts.error || stopReason === 'refusal',
      costUsd: 0,
      totalCostUsd: opts.totalCostUsd ?? 0,
      durationMs: Math.max(0, this.now() - this.turnStartedAt),
      numTurns: this.toolCalls + 1,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cachedReadTokens,
      cacheWriteTokens: usage.cachedWriteTokens,
      contextWindow: this.usage?.size || undefined,
      resultText: message ? message.blocks.filter((b): b is Extract<UiBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n') : undefined,
      stopReason,
    }
    this.emit({ type: 'result', result })
    return result
  }

  /** Drop any partially streamed state (process died). */
  reset(): void {
    this.streaming = null
    this.tools.clear()
    this.replay = null
    this.replayUser = null
  }

  private ensureStreaming(): StreamingMessage {
    if (this.streaming?.afterTool) {
      const done = this.finalizeStreaming()
      if (this.replay) this.replay.push(done)
      else this.emit({ type: 'assistant-message', message: done })
    }
    if (!this.streaming) {
      this.streaming = { id: randomUUID(), blocks: [], afterTool: false }
      if (!this.replay) this.emit({ type: 'assistant-start', messageId: this.streaming.id, parentToolUseId: null })
    }
    return this.streaming
  }

  private finalizeStreaming(): UiMessage {
    const s = this.streaming!
    this.streaming = null
    return { id: s.id, role: 'assistant', blocks: s.blocks, timestamp: this.now(), parentToolUseId: null, streaming: false }
  }

  private onAgentChunk(content: ContentBlock, kind: 'text' | 'thinking'): void {
    this.flushReplayUser()
    if (content.type === 'image') {
      const s = this.ensureStreaming()
      s.blocks.push({ type: 'image', mimeType: content.mimeType, data: content.data })
      return
    }
    const text = textOfContent(content)
    if (!text) return
    const s = this.ensureStreaming()
    const last = s.blocks[s.blocks.length - 1]
    let index: number
    if (last && last.type === kind) {
      last.text += text
      index = s.blocks.length - 1
    } else {
      s.blocks.push({ type: kind, text })
      index = s.blocks.length - 1
    }
    if (!this.replay) this.emit({ type: 'text-delta', messageId: s.id, blockIndex: index, text, kind })
  }

  private onUserChunk(content: ContentBlock): void {
    if (!this.replay) return
    if (this.streaming) {
      this.replay.push(this.finalizeStreaming())
    }
    if (!this.replayUser) this.replayUser = { id: randomUUID(), role: 'user', blocks: [], timestamp: this.now() }
    if (content.type === 'image') this.replayUser.blocks.push({ type: 'image', mimeType: content.mimeType, data: content.data })
    else {
      const text = textOfContent(content)
      if (!text) return
      const last = this.replayUser.blocks[this.replayUser.blocks.length - 1]
      if (last?.type === 'text') last.text += text
      else this.replayUser.blocks.push({ type: 'text', text })
    }
  }

  private flushReplayUser(): void {
    if (this.replay && this.replayUser) {
      this.replay.push(this.replayUser)
      this.replayUser = null
    }
  }

  private onToolCall(update: Extract<SessionUpdate, { sessionUpdate: 'tool_call' }>): void {
    this.flushReplayUser()
    const s = this.ensureStreaming()
    const block: UiToolUseBlock = { type: 'tool_use', toolUseId: update.toolCallId, name: toolNameOf(update), input: update.rawInput ?? {} }
    s.blocks.push(block)
    s.afterTool = true
    this.toolCalls++
    this.tools.set(update.toolCallId, { messageId: s.id, startedAt: this.now(), block, done: false, content: update.content?.length ? update.content : undefined })
    if (!this.replay) this.emit({ type: 'tool-use', messageId: s.id, block, parentToolUseId: null })
    if (update.status === 'completed' || update.status === 'failed') this.onToolCallUpdate({ ...update, sessionUpdate: 'tool_call_update' })
  }

  private onToolCallUpdate(update: ToolCallUpdate & { sessionUpdate?: string }): void {
    const t = this.tools.get(update.toolCallId)
    if (t) {
      let changed = false
      if (update.rawInput !== undefined && update.rawInput !== null && JSON.stringify(update.rawInput) !== JSON.stringify(t.block.input)) {
        t.block.input = update.rawInput
        changed = true
      }
      const name = toolNameOf(update)
      if (name !== 'tool' && name !== t.block.name && (t.block.name === 'tool' || (update._meta as { claudeCode?: { toolName?: string } } | undefined)?.claudeCode?.toolName)) {
        t.block.name = name
        changed = true
      }
      if (changed && !this.replay) this.emit({ type: 'tool-update', toolUseId: update.toolCallId, input: t.block.input, name: t.block.name })
      if (update.content?.length) t.content = update.content
    }
    if (update.status !== 'completed' && update.status !== 'failed') return
    if (!t || t.done) return
    t.done = true
    // The completion update may carry no content (Edit/Write): fall back to the diff/content seen earlier.
    const result = toolResultOf(update.content?.length ? update : { ...update, content: t.content })
    result.durationMs = Math.max(0, this.now() - t.startedAt)
    t.block.result = result
    if (!this.replay) this.emit({ type: 'tool-result', toolUseId: update.toolCallId, result })
  }
}
