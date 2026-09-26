import { randomUUID } from 'node:crypto'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentError,
  AgentErrorCode,
  AgentUiEvent,
  SessionState,
  TurnResult,
  UiBlock,
  UiImageBlock,
  UiMessage,
  UiToolResult,
  UiToolUseBlock,
} from '@shared/events'

type ContentBlock = { type: string; [k: string]: unknown }

interface StreamingMessage {
  id: string
  parentToolUseId: string | null
}

export interface ReducerOptions {
  /** Delta flush interval in ms (batching keeps IPC traffic sane). */
  flushMs?: number
  now?: () => number
  emit: (event: AgentUiEvent) => void
}

const ERROR_CODES: Record<string, AgentErrorCode> = {
  authentication_failed: 'authentication_failed',
  oauth_org_not_allowed: 'oauth_org_not_allowed',
  billing_error: 'billing_error',
  rate_limit: 'rate_limit',
  overloaded: 'overloaded',
  invalid_request: 'invalid_request',
  model_not_found: 'model_not_found',
  server_error: 'server_error',
  max_output_tokens: 'max_output_tokens',
}

const RETRYABLE: ReadonlySet<AgentErrorCode> = new Set([
  'rate_limit',
  'overloaded',
  'server_error',
  'process_exited',
  'unknown',
])

export function mapErrorCode(sdkError: string | undefined): AgentErrorCode {
  return (sdkError && ERROR_CODES[sdkError]) || 'unknown'
}

export function makeError(code: AgentErrorCode, message: string, resetsAt?: number): AgentError {
  return { code, message, retryable: RETRYABLE.has(code), resetsAt }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => {
      const block = b as ContentBlock
      if (block.type === 'text') return String(block.text ?? '')
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function imagesOf(content: unknown): UiImageBlock[] {
  if (!Array.isArray(content)) return []
  const out: UiImageBlock[] = []
  for (const b of content as ContentBlock[]) {
    if (b.type === 'image') {
      const source = b.source as { type?: string; media_type?: string; data?: string } | undefined
      if (source?.type === 'base64' && source.data)
        out.push({ type: 'image', mimeType: source.media_type ?? 'image/png', data: source.data })
    }
  }
  return out
}

/** Converts Anthropic assistant content blocks to UI blocks (shared by live reducer and history loader). */
export function assistantBlocksToUi(content: unknown): UiBlock[] {
  if (!Array.isArray(content))
    return typeof content === 'string' ? [{ type: 'text', text: content }] : []
  const out: UiBlock[] = []
  for (const raw of content as ContentBlock[]) {
    switch (raw.type) {
      case 'text':
        if (String(raw.text ?? '').length) out.push({ type: 'text', text: String(raw.text) })
        break
      case 'thinking':
        if (String(raw.thinking ?? '').trim())
          out.push({ type: 'thinking', text: String(raw.thinking) })
        break
      case 'tool_use':
        out.push({
          type: 'tool_use',
          toolUseId: String(raw.id),
          name: String(raw.name),
          input: raw.input,
        })
        break
      case 'image': {
        const [img] = imagesOf([raw])
        if (img) out.push(img)
        break
      }
      default:
        break
    }
  }
  return out
}

/** Extracts tool results from a user-role message (tool_result blocks). */
export function toolResultsOf(content: unknown): { toolUseId: string; result: UiToolResult }[] {
  if (!Array.isArray(content)) return []
  const out: { toolUseId: string; result: UiToolResult }[] = []
  for (const raw of content as ContentBlock[]) {
    if (raw.type !== 'tool_result') continue
    const inner = raw.content
    const images = imagesOf(inner)
    out.push({
      toolUseId: String(raw.tool_use_id),
      result: {
        content: textOf(inner),
        isError: raw.is_error === true,
        images: images.length ? images : undefined,
      },
    })
  }
  return out
}

/** Builds UI messages from persisted session transcript entries (getSessionMessages). */
export function historyToUi(
  entries: { type: string; uuid: string; message: unknown; parent_tool_use_id: string | null }[],
): UiMessage[] {
  const messages: UiMessage[] = []
  const toolIndex = new Map<string, UiToolUseBlock>()
  let ts = 0
  for (const entry of entries) {
    ts += 1
    const msg = entry.message as { role?: string; content?: unknown } | undefined
    if (!msg) continue
    if (entry.type === 'assistant') {
      const blocks = assistantBlocksToUi(msg.content)
      if (!blocks.length) continue
      for (const b of blocks) if (b.type === 'tool_use') toolIndex.set(b.toolUseId, b)
      messages.push({
        id: entry.uuid,
        role: 'assistant',
        blocks,
        timestamp: ts,
        parentToolUseId: entry.parent_tool_use_id,
      })
    } else if (entry.type === 'user') {
      const results = toolResultsOf(msg.content)
      if (results.length) {
        for (const r of results) {
          const block = toolIndex.get(r.toolUseId)
          if (block) block.result = r.result
        }
        continue
      }
      const text = textOf(msg.content)
      const images = imagesOf(msg.content)
      if (!text && !images.length) continue
      const blocks: UiBlock[] = []
      if (text) blocks.push({ type: 'text', text })
      blocks.push(...images)
      messages.push({ id: entry.uuid, role: 'user', blocks, timestamp: ts })
    }
  }
  return messages
}

/**
 * Turns the SDK message stream into UI events. Text deltas are coalesced per (message, block)
 * and flushed on a timer or whenever a non-delta message arrives.
 */
export class SessionReducer {
  private readonly emit: (e: AgentUiEvent) => void
  private readonly flushMs: number
  private readonly now: () => number
  private streaming = new Map<string, StreamingMessage>() // keyed by parent_tool_use_id ?? 'main'
  private pendingDeltas = new Map<
    string,
    { messageId: string; blockIndex: number; kind: 'text' | 'thinking'; text: string }
  >()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private lastTotalCost = 0
  private toolStart = new Map<string, number>()
  sessionId: string | null = null
  model: string | null = null
  state: SessionState = 'starting'

  constructor(opts: ReducerOptions) {
    this.emit = opts.emit
    this.flushMs = opts.flushMs ?? 33
    this.now = opts.now ?? (() => Date.now())
  }

  /** Seeds the cumulative cost so per-turn deltas stay correct after a resume. */
  seedCost(total: number): void {
    this.lastTotalCost = total
  }

  private key(parent: string | null): string {
    return parent ?? 'main'
  }

  private queueDelta(
    messageId: string,
    blockIndex: number,
    kind: 'text' | 'thinking',
    text: string,
  ): void {
    const k = `${messageId}:${blockIndex}`
    const cur = this.pendingDeltas.get(k)
    if (cur) cur.text += text
    else this.pendingDeltas.set(k, { messageId, blockIndex, kind, text })
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), this.flushMs)
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    for (const d of this.pendingDeltas.values()) {
      if (d.text)
        this.emit({
          type: 'text-delta',
          messageId: d.messageId,
          blockIndex: d.blockIndex,
          text: d.text,
          kind: d.kind,
        })
    }
    this.pendingDeltas.clear()
  }

  dispose(): void {
    this.flush()
  }

  private setState(state: SessionState): void {
    if (this.state === state) return
    this.state = state
    this.emit({ type: 'state', state })
  }

  handle(msg: SDKMessage): void {
    if (msg.type !== 'stream_event') this.flush()
    switch (msg.type) {
      case 'system':
        this.handleSystem(msg)
        break
      case 'stream_event':
        this.handleStreamEvent(msg)
        break
      case 'assistant':
        this.handleAssistant(msg)
        break
      case 'user':
        this.handleUser(msg)
        break
      case 'result':
        this.handleResult(msg)
        break
      case 'rate_limit_event':
        this.emit({
          type: 'rate-limit',
          info: {
            status: msg.rate_limit_info.status,
            rateLimitType: msg.rate_limit_info.rateLimitType,
            utilization: msg.rate_limit_info.utilization,
            resetsAt: msg.rate_limit_info.resetsAt,
          },
        })
        break
      case 'tool_progress':
        if (!this.toolStart.has(msg.tool_use_id))
          this.toolStart.set(msg.tool_use_id, this.now() - msg.elapsed_time_seconds * 1000)
        break
      default:
        break
    }
  }

  private handleSystem(msg: Extract<SDKMessage, { type: 'system' }>): void {
    switch (msg.subtype) {
      case 'init':
        this.sessionId = msg.session_id
        this.model = msg.model
        this.emit({
          type: 'session',
          sessionId: msg.session_id,
          state: 'idle',
          model: msg.model,
          tools: msg.tools,
        })
        this.setState('idle')
        break
      case 'session_state_changed':
        this.setState(
          msg.state === 'running'
            ? 'running'
            : msg.state === 'requires_action'
              ? 'awaiting_permission'
              : 'idle',
        )
        break
      case 'status':
        this.emit({ type: 'status', status: msg.status })
        break
      case 'api_retry':
        this.emit({
          type: 'status',
          status: 'retrying',
          detail: `${msg.attempt}/${msg.max_retries} (${msg.error})`,
        })
        break
      case 'compact_boundary':
        this.emit({ type: 'compact' })
        break
      default:
        break
    }
  }

  private handleStreamEvent(msg: Extract<SDKMessage, { type: 'stream_event' }>): void {
    const ev = msg.event as {
      type: string
      index?: number
      delta?: { type?: string; text?: string; thinking?: string }
    }
    const key = this.key(msg.parent_tool_use_id)
    if (ev.type === 'message_start') {
      const id = randomUUID()
      this.streaming.set(key, { id, parentToolUseId: msg.parent_tool_use_id })
      this.emit({ type: 'assistant-start', messageId: id, parentToolUseId: msg.parent_tool_use_id })
      return
    }
    if (ev.type === 'content_block_delta' && ev.delta) {
      const cur = this.streaming.get(key)
      if (!cur) return
      if (ev.delta.type === 'text_delta' && ev.delta.text)
        this.queueDelta(cur.id, ev.index ?? 0, 'text', ev.delta.text)
      else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking)
        this.queueDelta(cur.id, ev.index ?? 0, 'thinking', ev.delta.thinking)
    }
  }

  private handleAssistant(msg: Extract<SDKMessage, { type: 'assistant' }>): void {
    const key = this.key(msg.parent_tool_use_id)
    const streaming = this.streaming.get(key)
    const id = streaming?.id ?? randomUUID()
    this.streaming.delete(key)
    const blocks = assistantBlocksToUi(msg.message.content)
    const message: UiMessage = {
      id,
      role: 'assistant',
      blocks,
      timestamp: this.now(),
      parentToolUseId: msg.parent_tool_use_id,
      streaming: false,
    }
    for (const b of blocks) {
      if (b.type === 'tool_use') {
        this.toolStart.set(b.toolUseId, this.now())
        this.emit({
          type: 'tool-use',
          messageId: id,
          block: b,
          parentToolUseId: msg.parent_tool_use_id,
        })
      }
    }
    this.emit({ type: 'assistant-message', message })
    if (msg.error) {
      const code = mapErrorCode(msg.error)
      this.emit({ type: 'error', error: makeError(code, textOf(msg.message.content) || msg.error) })
    }
  }

  private handleUser(msg: Extract<SDKMessage, { type: 'user' }>): void {
    const results = toolResultsOf(msg.message.content)
    for (const r of results) {
      const started = this.toolStart.get(r.toolUseId)
      if (started) {
        r.result.durationMs = Math.max(0, this.now() - started)
        this.toolStart.delete(r.toolUseId)
      }
      this.emit({ type: 'tool-result', toolUseId: r.toolUseId, result: r.result })
    }
  }

  private handleResult(msg: Extract<SDKMessage, { type: 'result' }>): void {
    const usage = msg.usage as {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    const modelUsage = Object.values(msg.modelUsage ?? {})
    const contextWindow =
      modelUsage.reduce((m, u) => Math.max(m, u.contextWindow ?? 0), 0) || undefined
    const total = msg.total_cost_usd ?? 0
    const cost = Math.max(0, total - this.lastTotalCost)
    this.lastTotalCost = total
    const result: TurnResult = {
      turnId: msg.uuid,
      subtype: msg.subtype,
      isError: msg.is_error,
      costUsd: cost,
      totalCostUsd: total,
      durationMs: msg.duration_ms,
      numTurns: msg.num_turns,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      contextWindow,
      resultText: msg.subtype === 'success' ? msg.result : undefined,
      stopReason: msg.stop_reason,
    }
    this.emit({ type: 'result', result })
    if (msg.subtype !== 'success') {
      const errors = msg.errors?.length ? msg.errors.join('\n') : msg.subtype
      const code: AgentErrorCode =
        msg.subtype === 'error_max_turns'
          ? 'max_turns'
          : msg.subtype === 'error_max_budget_usd'
            ? 'max_budget'
            : msg.startup_failure_reason
              ? 'startup_failed'
              : 'unknown'
      this.emit({
        type: 'error',
        error: makeError(
          code,
          msg.startup_failure_reason ? `${msg.startup_failure_reason}: ${errors}` : errors,
        ),
      })
    }
    this.setState('idle')
  }
}
