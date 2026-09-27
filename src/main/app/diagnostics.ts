import { existsSync, readFileSync } from 'node:fs'
import type { AppInfo, InputDriverInfo, OsPermissionStatus } from '@shared/events'
import type { Settings } from '@shared/settings'

/** Last N bytes of the log file to include — enough for a recent crash, not the whole history. */
const MAX_LOG_BYTES = 512 * 1024

export function readLogTail(logFilePath: string, maxBytes = MAX_LOG_BYTES): string {
  if (!existsSync(logFilePath)) return ''
  const buf = readFileSync(logFilePath)
  if (buf.length <= maxBytes) return buf.toString('utf8')
  return `…(truncated, showing the last ${maxBytes} bytes)…\n${buf.subarray(buf.length - maxBytes).toString('utf8')}`
}

export interface DiagnosticsReportInput {
  appInfo: AppInfo
  settings: Settings
  osPermissions: OsPermissionStatus
  logFilePath: string
  /** OBS-01: which InputDriver (robotjs/native-cli) is active and why the others were skipped. */
  inputDriver?: InputDriverInfo
  now?: Date
}

/**
 * OBS-01: a single-file diagnostic report for support requests — app/environment info, the
 * settings the agent is actually running with, OS permission state, and a recent log tail.
 * Settings never hold secrets directly (the proxy password and any auth token/API key live in the
 * OS keychain / safeStorage, never in the settings file — see ProxySettingsSchema/AuthSettingsSchema),
 * so the whole settings object is safe to include verbatim rather than needing field-by-field redaction.
 */
export function buildDiagnosticsReport(input: DiagnosticsReportInput): Record<string, unknown> {
  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    app: input.appInfo,
    osPermissions: input.osPermissions,
    settings: input.settings,
    inputDriver: input.inputDriver ?? null,
    log: { path: input.logFilePath, tail: readLogTail(input.logFilePath) },
  }
}
