import { z } from 'zod'

// ---------- Settings schema (single source of truth for main + renderer) ----------

export const EffortSchema = z.enum(['default', 'low', 'medium', 'high', 'xhigh', 'max'])
export const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'auto', 'bypassPermissions'])
/** How Vivi talks to Claude: in-process Agent SDK, or an external agent over the Agent Client Protocol. */
export const AgentBackendSchema = z.enum(['sdk', 'acp'])

export const AgentSettingsSchema = z.object({
  /** Model id or alias; empty string = Claude Code default model. */
  model: z.string().default(''),
  fallbackModel: z.string().default(''),
  effort: EffortSchema.default('default'),
  permissionMode: PermissionModeSchema.default('default'),
  /** Working directory for the agent; empty = ~/Vivi. */
  workspaceDir: z.string().default(''),
  additionalDirectories: z.array(z.string()).default([]),
  maxTurns: z.number().int().min(1).max(500).default(80),
  /** 0 = unlimited. */
  maxBudgetUsd: z.number().min(0).default(0),
  continueLastSession: z.boolean().default(true),
  /** Extra instructions appended to Vivi's system prompt. */
  customInstructions: z.string().default(''),
  backend: AgentBackendSchema.default('sdk'),
  /** ACP agent executable; empty = the bundled Claude ACP adapter (claude-agent-acp). */
  acpCommand: z.string().default(''),
  /** Extra command-line arguments for the ACP agent (shell-like quoting). */
  acpArgs: z.string().default(''),
  /** AG-10: png is lossless (best for reading small text) but much larger/slower than jpeg. */
  screenshotFormat: z.enum(['png', 'jpeg']).default('png'),
  /** Only used when screenshotFormat is 'jpeg'. */
  screenshotQuality: z.number().int().min(10).max(100).default(80),
})

export const PermissionRuleSchema = z.object({
  toolName: z.string(),
  ruleContent: z.string().optional(),
})

/**
 * INT-01: a user-configured external MCP server, merged into the agent's tools (SDK backend
 * only — see docs/INTEGRATIONS.md for why ACP mode doesn't support these yet). Deliberately not
 * agent-creatable: unlike a skill (text), an integration runs an arbitrary program the user
 * chose, so adding one is a decision only the user makes, through this settings screen.
 */
export const IntegrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  transport: z.enum(['stdio', 'http']).default('stdio'),
  command: z.string().default(''),
  args: z.string().default(''),
  url: z.string().default(''),
})

export const PermissionSettingsSchema = z.object({
  autoAllowReadOnly: z.boolean().default(true),
  /** Screenshots and clipboard reads can surface passwords/PII; gated separately from autoAllowReadOnly. */
  autoAllowScreenshot: z.boolean().default(true),
  autoAllowClipboardRead: z.boolean().default(true),
  askForEdits: z.boolean().default(true),
  askForExec: z.boolean().default(true),
  askForInput: z.boolean().default(true),
  askForSystem: z.boolean().default(true),
  alwaysAllowRules: z.array(PermissionRuleSchema).default([]),
})

export const ProxySettingsSchema = z.object({
  mode: z.enum(['none', 'system', 'manual']).default('none'),
  scheme: z.enum(['http', 'https', 'socks5']).default('http'),
  host: z.string().default(''),
  port: z.number().int().min(0).max(65535).default(0),
  username: z.string().default(''),
  /** Password itself lives in the encrypted secret store. */
  hasPassword: z.boolean().default(false),
  bypass: z.string().default('localhost,127.0.0.1,<local>'),
  caCertPath: z.string().default(''),
})

export const VoiceSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  language: z.enum(['ru', 'en', 'auto']).default('ru'),
  sttProvider: z.enum(['local', 'openai']).default('local'),
  ttsProvider: z.enum(['local', 'openai', 'system']).default('local'),
  sttModel: z.string().default('stt-zipformer-small-ru'),
  ttsVoice: z.string().default('tts-piper-ru-irina'),
  wakeWordEnabled: z.boolean().default(true),
  wakeWordStrategy: z.enum(['kws', 'transcript']).default('transcript'),
  wakeWordSensitivity: z.number().min(0).max(1).default(0.75),
  speakReplies: z.boolean().default(true),
  inputDeviceId: z.string().default(''),
  outputDeviceId: z.string().default(''),
  silenceMs: z.number().int().min(300).max(3000).default(800),
  /** VO-03: listen without the wake word for this long after Vivi finishes speaking a reply. 0 disables it. */
  followupMs: z.number().int().min(0).max(30_000).default(8_000),
  /** VO-04: only the wake word interrupts TTS playback, instead of any sustained nearby speech. */
  bargeInRequiresWakeWord: z.boolean().default(false),
  openaiVoice: z.string().default('alloy'),
})

export const AppearanceSettingsSchema = z.object({
  theme: z.enum(['system', 'dark', 'light']).default('system'),
  language: z.enum(['ru', 'en']).default('ru'),
  launchAtLogin: z.boolean().default(false),
  startMinimized: z.boolean().default(false),
  overlayHotkey: z.string().default('CommandOrControl+Shift+Space'),
  killSwitchHotkey: z.string().default('CommandOrControl+Shift+Escape'),
  reduceMotion: z.boolean().default(false),
})

export const AuthModeSchema = z.enum([
  'none',
  'claude-login',
  'oauth-token',
  'api-key',
  'existing-claude',
])

export const AuthSettingsSchema = z.object({
  mode: AuthModeSchema.default('none'),
})

export const FeatureFlagsSchema = z.object({
  cloudVoice: z.boolean().default(false),
  appRegistry: z.boolean().default(true),
  autoUpdate: z.boolean().default(false),
  debugSdk: z.boolean().default(false),
})

export const SettingsSchema = z.object({
  schemaVersion: z.number().int().default(1),
  onboardingCompleted: z.boolean().default(false),
  agent: AgentSettingsSchema.prefault({}),
  permissions: PermissionSettingsSchema.prefault({}),
  proxy: ProxySettingsSchema.prefault({}),
  voice: VoiceSettingsSchema.prefault({}),
  appearance: AppearanceSettingsSchema.prefault({}),
  auth: AuthSettingsSchema.prefault({}),
  features: FeatureFlagsSchema.prefault({}),
  integrations: z.array(IntegrationSchema).default([]),
})

export type Settings = z.infer<typeof SettingsSchema>
export type AgentSettings = z.infer<typeof AgentSettingsSchema>
export type PermissionSettings = z.infer<typeof PermissionSettingsSchema>
export type PermissionRule = z.infer<typeof PermissionRuleSchema>
export type Integration = z.infer<typeof IntegrationSchema>
export type ProxySettings = z.infer<typeof ProxySettingsSchema>
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>
export type AuthMode = z.infer<typeof AuthModeSchema>
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>
export type Effort = z.infer<typeof EffortSchema>
export type PermissionMode = z.infer<typeof PermissionModeSchema>
export type AgentBackendKind = z.infer<typeof AgentBackendSchema>

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

export const defaultSettings = (): Settings => SettingsSchema.parse({})
