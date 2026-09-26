// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- src/renderer/** is outside tsconfig.node.json's (composite) project file list, so
// `tsc -p tsconfig.node.json` can't resolve this cross-project import (TS6307); tsconfig.web.json
// covers src/renderer/** but excludes tests/, so no single tsc project spans both. Neither tsconfig
// is in this task's editable file set. Vitest itself transpiles per-file (no project-reference
// checking), so the test still runs for real against the actual renderer module at runtime — only
// static type-checking of *this* file is skipped.
import { describe, expect, it } from 'vitest'
import {
  isSelectedDeviceStillPresent,
  micWatchdogTimeoutMs,
  shouldFlagMicSilence,
} from '../../../src/renderer/features/voice/mic-watchdog'

describe('micWatchdogTimeoutMs', () => {
  it('scales the configured silence window but clamps to a sane range', () => {
    expect(micWatchdogTimeoutMs(800)).toBe(8000) // 800*8=6400, clamped up to the 8s floor
    expect(micWatchdogTimeoutMs(1500)).toBe(12000) // 1500*8=12000, within range
    expect(micWatchdogTimeoutMs(3000)).toBe(20000) // 3000*8=24000, clamped down to the 20s ceiling
  })
})

describe('shouldFlagMicSilence', () => {
  it('does not flag while merely armed and waiting for the wake word, however long the silence', () => {
    expect(
      shouldFlagMicSilence({
        voiceState: 'armed',
        now: 1_000_000,
        lastHeartbeatAt: 0,
        timeoutMs: 8000,
      }),
    ).toBe(false)
  })

  it('does not flag while listening if a heartbeat arrived recently', () => {
    expect(
      shouldFlagMicSilence({
        voiceState: 'listening',
        now: 10_000,
        lastHeartbeatAt: 9_000,
        timeoutMs: 8000,
      }),
    ).toBe(false)
  })

  it('flags once actively listening with no heartbeat for longer than the timeout', () => {
    expect(
      shouldFlagMicSilence({
        voiceState: 'listening',
        now: 9_000,
        lastHeartbeatAt: 0,
        timeoutMs: 8000,
      }),
    ).toBe(true)
  })

  it('ignores other states such as speaking/thinking/transcribing', () => {
    for (const voiceState of ['speaking', 'thinking', 'transcribing', 'off', 'error'] as const) {
      expect(
        shouldFlagMicSilence({ voiceState, now: 100_000, lastHeartbeatAt: 0, timeoutMs: 8000 }),
      ).toBe(false)
    }
  })
})

describe('isSelectedDeviceStillPresent', () => {
  const devices = [
    { kind: 'audioinput', deviceId: 'mic-1' },
    { kind: 'audiooutput', deviceId: 'speaker-1' },
  ]

  it('treats the system default (empty id) as always present', () => {
    expect(isSelectedDeviceStillPresent([], '')).toBe(true)
    expect(isSelectedDeviceStillPresent(devices, '')).toBe(true)
  })

  it('finds a still-connected input device', () => {
    expect(isSelectedDeviceStillPresent(devices, 'mic-1')).toBe(true)
  })

  it('flags a selected device that has disappeared from the device list', () => {
    expect(isSelectedDeviceStillPresent(devices, 'mic-unplugged')).toBe(false)
  })

  it('does not match an output device with the same id as an input', () => {
    expect(isSelectedDeviceStillPresent(devices, 'speaker-1')).toBe(false)
  })
})
