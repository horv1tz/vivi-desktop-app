// ---------- UI-facing event model (produced by the main process reducer) ----------

export type SessionState =
  | 'starting'
  | 'idle'
  | 'running'
  | 'awaiting_permission'
  | 'awaiting_question'
  | 'closing'
  | 'closed'
  | 'failed'

export interface UiTextBlock {
  type: 'text'
  text: string
}
export interface UiThinkingBlock {
  type: 'thinking'
  text: string
}
export interface UiImageBlock {
  type: 'image'
  mimeType: string
  data: string
}
export interface UiToolUseBlock {
  type: 'tool_use'
  toolUseId: string
  name: string
  input: unknown
  /** Set once the tool result arrives. */
  result?: UiToolResult
}
export interface UiToolResult {
  content: string
  isError: boolean
  images?: UiImageBlock[]
  durationMs?: number
}
export type UiBlock = UiTextBlock | UiThinkingBlock | UiImageBlock | UiToolUseBlock

export interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  blocks: UiBlock[]
  timestamp: number
  /** For subagent output. */
  parentToolUseId?: string | null
  streaming?: boolean
}

export interface TurnResult {
  turnId: string
  subtype: string
  isError: boolean
  /** Undefined (not 0) when the backend never reported a cost for this turn — e.g. a third-party ACP agent. */
  costUsd?: number
  totalCostUsd?: number
  durationMs: number
  numTurns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  contextWindow?: number
  resultText?: string
  stopReason?: string | null
}

export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  rateLimitType?: string
  utilization?: number
  resetsAt?: number
}

export type AgentErrorCode =
  | 'authentication_failed'
  | 'oauth_org_not_allowed'
  | 'billing_error'
  | 'rate_limit'
  | 'overloaded'
  | 'invalid_request'
  | 'model_not_found'
  | 'server_error'
  | 'max_output_tokens'
  | 'process_exited'
  | 'startup_failed'
  | 'max_turns'
  | 'max_budget'
  | 'unknown'

export interface AgentError {
  code: AgentErrorCode
  message: string
  retryable: boolean
  resetsAt?: number
}

export type AgentUiEvent =
  | {
      type: 'session'
      sessionId: string
      state: SessionState
      model?: string
      tools?: string[]
      title?: string
    }
  | { type: 'state'; state: SessionState }
  | { type: 'status'; status: 'compacting' | 'requesting' | 'retrying' | null; detail?: string }
  | { type: 'user-message'; message: UiMessage }
  | { type: 'assistant-start'; messageId: string; parentToolUseId: string | null }
  | {
      type: 'text-delta'
      messageId: string
      blockIndex: number
      text: string
      kind: 'text' | 'thinking'
    }
  | { type: 'assistant-message'; message: UiMessage }
  | { type: 'tool-use'; messageId: string; block: UiToolUseBlock; parentToolUseId: string | null }
  | { type: 'tool-result'; toolUseId: string; result: UiToolResult }
  /** Late-arriving tool input/name (ACP streams the call before its arguments are complete). */
  | { type: 'tool-update'; toolUseId: string; input?: unknown; name?: string }
  | { type: 'result'; result: TurnResult }
  | { type: 'error'; error: AgentError }
  | { type: 'rate-limit'; info: RateLimitInfo }
  | { type: 'history'; messages: UiMessage[] }
  | { type: 'compact' }

export interface SessionSummary {
  sessionId: string
  title: string
  lastModified: number
  firstPrompt?: string
}

export interface PermissionRequest {
  requestId: string
  toolName: string
  input: unknown
  title?: string
  displayName?: string
  description?: string
  reason?: string
  category: PermissionCategory
  dangerous: boolean
  dangerReasons: string[]
  canAlwaysAllow: boolean
  suggestionsCount: number
}

export type PermissionCategory = 'read' | 'edit' | 'exec' | 'input' | 'system' | 'unknown'

export type PermissionDecision = 'allow' | 'allow-always' | 'allow-session' | 'deny'

export interface QuestionOption {
  label: string
  description?: string
}
export interface QuestionItem {
  question: string
  header?: string
  multiSelect?: boolean
  options: QuestionOption[]
}
export interface QuestionRequest {
  requestId: string
  questions: QuestionItem[]
}

export type VoiceState =
  'off' | 'armed' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error'

export interface VoiceStateEvent {
  state: VoiceState
  detail?: string
  level?: number
}

export interface VoiceTranscriptEvent {
  text: string
  final: boolean
}

export interface ModelDownloadProgress {
  modelId: string
  receivedBytes: number
  totalBytes: number
  status: 'downloading' | 'extracting' | 'done' | 'error'
  error?: string
}

export interface AuthStatus {
  mode: 'none' | 'claude-login' | 'oauth-token' | 'api-key' | 'existing-claude'
  loggedIn: boolean
  authMethod?: string
  email?: string
  organization?: string
  subscriptionType?: string
  error?: string
  /** SEC-06: false when secrets are only obfuscated (base64), not actually encrypted — e.g. Linux with no keyring/wallet available for Electron's safeStorage. */
  secretsSecure: boolean
}

export interface LoginFlowEvent {
  phase: 'starting' | 'url' | 'waiting-code' | 'success' | 'error' | 'cancelled'
  url?: string
  message?: string
}

/** Progress/status of an app update check, download or install (see src/main/app/updater.ts). */
export type UpdateStatus =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'downloading'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

export interface AppInfo {
  version: string
  platform: Platform
  arch: string
  isPackaged: boolean
  userDataPath: string
  logsPath: string
  workspaceDir: string
  claudeBinary: string | null
  sdkVersion: string
  mockAgent: boolean
  /** Active agent backend. */
  backend: 'mock' | 'sdk' | 'acp'
  acpAdapterVersion: string
}

export interface OsPermissionStatus {
  microphone: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' | 'n/a'
  screen: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' | 'n/a'
  accessibility: 'granted' | 'denied' | 'unknown' | 'n/a'
  /** CU-06: can Vivi drive other apps via Apple Events (osascript to System Events, window focus, etc.). */
  automation: 'granted' | 'denied' | 'unknown' | 'n/a'
}

/** AG-03: a structured memory entry the agent recorded about the user. */
export type MemoryEntryType = 'profile' | 'preference' | 'fact' | 'project'

export interface MemoryEntry {
  id: string
  type: MemoryEntryType
  text: string
  createdAt: number
}

/**
 * A named, reusable block of instructions injected into the system prompt when enabled — a
 * "skill" or custom instruction set. `source` distinguishes one the user wrote in Settings from
 * one the agent authored itself via the manage_skill tool, purely for display (both are treated
 * identically once saved).
 */
export interface SkillEntry {
  id: string
  name: string
  description: string
  body: string
  enabled: boolean
  source: 'user' | 'agent'
  createdAt: number
  updatedAt: number
}

/**
 * WORK-02: one concrete, executable step of a scenario. Deliberately a small, closed vocabulary
 * (not "run any tool") — scenarios are meant to be pre-built, reviewable macros the user assembles
 * once and Vivi replays deterministically, not a way to smuggle in arbitrary tool calls.
 */
export type ScenarioStepKind = 'open' | 'wait' | 'key' | 'type' | 'notify'

export interface ScenarioStep {
  kind: ScenarioStepKind
  /** 'open': app name, path or URL. */
  target?: string
  /** 'wait': milliseconds to pause before the next step. */
  ms?: number
  /** 'key': a combo like "space" or "ctrl+shift+t", same syntax as the keyboard tool. */
  keys?: string
  /** 'type': literal text to type. */
  text?: string
  /** 'notify': notification title. */
  title?: string
  /** 'notify': notification body. */
  body?: string
}

/**
 * WORK-02: a named, ready-made sequence of steps Vivi runs on request (e.g. "open Spotify and
 * press play") via the run_scenario tool, instead of reasoning through each step itself. Unlike a
 * skill (plain text) or an integration (an external program), a scenario performs real actions on
 * the user's computer directly — so, like an integration, it is deliberately never
 * agent-authorable: only the user assembles one, through the Workshop screen.
 */
export interface ScenarioEntry {
  id: string
  name: string
  description: string
  /** Example phrases that should trigger this scenario, shown to the model so it can match intent. */
  triggerPhrases: string[]
  steps: ScenarioStep[]
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/**
 * SEC-03: why a permission verdict came out the way it did — distinguishes a rule/setting that
 * decided it automatically from an explicit in-the-moment user choice, for the decision log.
 */
export type PermissionLogReason =
  | 'deny-rule'
  | 'trusted-folder'
  | 'auto-category'
  | 'allow-rule'
  | 'session-grant'
  | 'turn-grant'
  | 'dialog-allow'
  | 'dialog-allow-session'
  | 'dialog-allow-always'
  | 'dialog-deny'

/** SEC-03: one permission verdict, whether decided automatically by policy or by the user in a dialog. */
export interface PermissionLogEntry {
  id: string
  timestamp: number
  toolName: string
  /** JSON-stringified tool input, truncated if large — same convention as JournalEntry.input. */
  input: string
  verdict: 'allow' | 'deny'
  reason: PermissionLogReason
}

/** AG-02: one recorded agent action ("what did Vivi do"), keyed by its tool_use id. */
export interface JournalEntry {
  id: string
  toolUseId: string
  name: string
  /** JSON-stringified tool input, truncated if large. */
  input: string
  timestamp: number
  parentToolUseId: string | null
  result?: { content: string; isError: boolean; durationMs?: number }
}

/**
 * OBS-02: one completed turn's cost/token usage, recorded from `TurnResult`. There is no
 * per-tool-call cost breakdown to record here — the API only reports cost/tokens per top-level
 * turn (a single `result` message), not per tool invocation within it.
 */
export interface MetricEntry {
  id: string
  sessionId: string
  timestamp: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  durationMs: number
}

export interface MetricsDailyTotal {
  /** Local calendar date, YYYY-MM-DD. */
  date: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  turns: number
}

export interface MetricsSessionTotal {
  sessionId: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  turns: number
  lastTimestamp: number
}

export interface MetricsSummary {
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTurns: number
  daily: MetricsDailyTotal[]
  sessions: MetricsSessionTotal[]
}

/** OBS-01: which InputDriver (robotjs/native-cli) is active, and what was tried and skipped. */
export interface InputDriverInfo {
  active: string | null
  attempts: { name: string; ok: boolean; reason?: string }[]
}
