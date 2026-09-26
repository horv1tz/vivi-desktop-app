import type { DeepPartial, Settings } from './settings'
import type {
  AgentUiEvent,
  Platform,
  AppInfo,
  AuthStatus,
  JournalEntry,
  LoginFlowEvent,
  ModelDownloadProgress,
  OsPermissionStatus,
  PermissionDecision,
  PermissionRequest,
  QuestionRequest,
  SessionState,
  SessionSummary,
  UiMessage,
  UpdateStatus,
  VoiceState,
  VoiceStateEvent,
  VoiceTranscriptEvent,
} from './events'

// ---------- Typed IPC contract shared by main, preload and renderer ----------

export interface SendArgs {
  text: string
  /** base64 PNG/JPEG attachments */
  images?: { mimeType: string; data: string }[]
  /** true when the text came from speech; the reply is spoken back */
  fromVoice?: boolean
}

export interface AgentStateSnapshot {
  sessionId: string | null
  state: SessionState
  model: string | null
  title: string | null
  totalCostUsd?: number
}

export interface ProxyTestResult {
  ok: boolean
  status?: number
  latencyMs?: number
  error?: string
  via: string
}

export interface VoiceModelInfo {
  id: string
  kind: 'stt' | 'tts' | 'vad' | 'kws'
  name: string
  language: string
  sizeMb: number
  installed: boolean
  description?: string
}

export interface InvokeMap {
  'app:getInfo': { args: []; result: AppInfo }
  'app:getOsPermissions': { args: []; result: OsPermissionStatus }
  'app:requestOsPermission': {
    args: ['microphone' | 'screen' | 'accessibility' | 'automation']
    result: boolean
  }
  'app:openLogs': { args: []; result: void }
  'app:relaunch': { args: []; result: void }
  /** OBS-01: writes a diagnostics report (app info, redaction-free settings, OS permissions, log
   *  tail) to a user-chosen file. Returns the saved path, or null if the save dialog was cancelled. */
  'diagnostics:export': { args: []; result: string | null }
  'journal:list': { args: []; result: JournalEntry[] }
  'journal:clear': { args: []; result: void }
  'journal:export': { args: []; result: string | null }

  'update:check': { args: []; result: void }
  'update:install': { args: []; result: void }

  'settings:get': { args: []; result: Settings }
  'settings:update': { args: [DeepPartial<Settings>]; result: Settings }
  'settings:reset': { args: []; result: Settings }
  'settings:pickDirectory': { args: [string | undefined]; result: string | null }
  'settings:pickFile': { args: [string | undefined]; result: string | null }

  'agent:send': { args: [SendArgs]; result: { messageId: string } }
  'agent:interrupt': { args: []; result: void }
  'agent:getState': { args: []; result: AgentStateSnapshot }
  'agent:newSession': { args: []; result: void }
  'agent:listSessions': { args: []; result: SessionSummary[] }
  'agent:resumeSession': { args: [string]; result: UiMessage[] }
  'agent:renameSession': { args: [string, string]; result: void }
  'agent:deleteSession': { args: [string]; result: void }
  'agent:listModels': { args: []; result: { id: string; name: string; description?: string }[] }

  'permission:respond': { args: [string, PermissionDecision]; result: void }
  'question:respond': { args: [string, Record<string, string>]; result: void }

  'auth:getStatus': { args: []; result: AuthStatus }
  'auth:startClaudeLogin': { args: ['claudeai' | 'console']; result: void }
  'auth:submitLoginCode': { args: [string]; result: void }
  'auth:cancelLogin': { args: []; result: void }
  'auth:setOauthToken': { args: [string]; result: AuthStatus }
  'auth:setApiKey': { args: [string]; result: AuthStatus }
  'auth:useExistingClaude': { args: []; result: AuthStatus }
  'auth:logout': { args: []; result: AuthStatus }

  'proxy:setPassword': { args: [string]; result: void }
  'proxy:test': { args: []; result: ProxyTestResult }

  'voice:listModels': { args: []; result: VoiceModelInfo[] }
  'voice:downloadModel': { args: [string]; result: void }
  'voice:deleteModel': { args: [string]; result: void }
  'voice:start': { args: []; result: void }
  'voice:stop': { args: []; result: void }
  'voice:pushToTalk': { args: [boolean]; result: void }
  'voice:speak': { args: [string]; result: void }
  'voice:stopSpeaking': { args: []; result: void }
  'voice:getState': { args: []; result: VoiceState }
  'voice:setCloudKey': { args: ['openai', string]; result: void }
  'voice:playbackEnded': { args: [number]; result: void }

  'window:showMain': { args: []; result: void }
  'window:hideOverlay': { args: []; result: void }
  'window:toggleOverlay': { args: []; result: void }
  'window:minimize': { args: []; result: void }
  'window:maximize': { args: []; result: void }
  'window:close': { args: []; result: void }

  'shell:openExternal': { args: [string]; result: void }
  'shell:openPath': { args: [string]; result: void }
}

export interface EventMap {
  'agent:event': AgentUiEvent
  'permission:request': PermissionRequest
  'permission:resolved': { requestId: string }
  'question:request': QuestionRequest
  'question:resolved': { requestId: string }
  'settings:changed': Settings
  'auth:status': AuthStatus
  'auth:loginFlow': LoginFlowEvent
  'voice:state': VoiceStateEvent
  'voice:transcript': VoiceTranscriptEvent
  'voice:audio': {
    generation: number
    seq: number
    sampleRate: number
    pcm: ArrayBuffer
    last: boolean
  }
  'voice:stopPlayback': { generation: number }
  'voice:modelProgress': ModelDownloadProgress
  'voice:level': number
  'overlay:visibility': boolean
  'app:notification': { title: string; body: string; level?: 'info' | 'warn' | 'error' }
  'update:status': UpdateStatus
}

export type InvokeChannel = keyof InvokeMap
export type EventChannel = keyof EventMap

export interface ViviBridge {
  platform: Platform
  invoke<K extends InvokeChannel>(
    channel: K,
    ...args: InvokeMap[K]['args']
  ): Promise<InvokeMap[K]['result']>
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void
}
