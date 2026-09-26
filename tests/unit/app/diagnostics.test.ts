import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDiagnosticsReport, readLogTail } from '../../../src/main/app/diagnostics'
import { defaultSettings } from '../../../src/shared/settings'
import type { AppInfo, OsPermissionStatus } from '../../../src/shared/events'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vivi-diagnostics-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const appInfo: AppInfo = {
  version: '0.1.1',
  platform: 'linux',
  arch: 'x64',
  isPackaged: true,
  userDataPath: '/data',
  logsPath: '/logs',
  workspaceDir: '/work',
  claudeBinary: null,
  sdkVersion: '0.3.283',
  mockAgent: false,
  backend: 'sdk',
  acpAdapterVersion: '1.0.0',
}
const osPermissions: OsPermissionStatus = {
  microphone: 'granted',
  screen: 'n/a',
  accessibility: 'n/a',
}

describe('readLogTail (OBS-01)', () => {
  it('returns an empty string when the log file does not exist', () => {
    expect(readLogTail(join(dir, 'missing.log'))).toBe('')
  })

  it('returns the whole file when it is under the size cap', () => {
    const logFile = join(dir, 'vivi.log')
    writeFileSync(logFile, 'hello\nworld\n')
    expect(readLogTail(logFile, 1024)).toBe('hello\nworld\n')
  })

  it('truncates to the last N bytes and marks it as truncated', () => {
    const logFile = join(dir, 'vivi.log')
    writeFileSync(logFile, 'aaaaaaaaaabbbbbbbbbb')
    const tail = readLogTail(logFile, 10)
    expect(tail).toContain('truncated')
    expect(tail.endsWith('bbbbbbbbbb')).toBe(true)
  })
})

describe('buildDiagnosticsReport (OBS-01)', () => {
  it('includes app info, settings, OS permissions and the log tail', () => {
    const logFile = join(dir, 'vivi.log')
    writeFileSync(logFile, 'log line 1\nlog line 2\n')
    const now = new Date('2026-01-01T00:00:00.000Z')
    const report = buildDiagnosticsReport({
      appInfo,
      settings: defaultSettings(),
      osPermissions,
      logFilePath: logFile,
      now,
    })
    expect(report).toMatchObject({
      generatedAt: '2026-01-01T00:00:00.000Z',
      app: appInfo,
      osPermissions,
      log: { path: logFile, tail: 'log line 1\nlog line 2\n' },
    })
    // The settings object never carries a raw secret (see the schema comments this test protects
    // against regressing) — the whole thing goes in the report unredacted.
    expect(report.settings).toEqual(defaultSettings())
  })
})
