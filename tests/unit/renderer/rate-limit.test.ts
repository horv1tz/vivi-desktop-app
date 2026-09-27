// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- src/renderer/** is outside tsconfig.node.json's (composite) project file list, so
// `tsc -p tsconfig.node.json` can't resolve this cross-project import (TS6307); tsconfig.web.json
// covers src/renderer/** but excludes tests/, so no single tsc project spans both (see the same
// workaround in tests/unit/voice/mic-watchdog.test.ts). Vitest transpiles per-file at runtime, so
// the test still runs for real against the actual renderer module — only static type-checking of
// *this* file is skipped.
import { describe, expect, it } from 'vitest'
import { isRateLimited, rateLimitResetsAtMs } from '../../../src/renderer/lib/rate-limit'
import type { RateLimitInfo } from '../../../src/shared/events'

describe('rateLimitResetsAtMs', () => {
  it('is null when there is no rate limit info at all', () => {
    expect(rateLimitResetsAtMs(null)).toBeNull()
    expect(rateLimitResetsAtMs(undefined)).toBeNull()
  })

  it('is null for allowed/allowed_warning, even with a resetsAt', () => {
    const info: RateLimitInfo = { status: 'allowed_warning', resetsAt: 1000 }
    expect(rateLimitResetsAtMs(info)).toBeNull()
  })

  it('converts a rejected status resetsAt (seconds) to milliseconds', () => {
    const info: RateLimitInfo = { status: 'rejected', resetsAt: 1_700_000_000 }
    expect(rateLimitResetsAtMs(info)).toBe(1_700_000_000_000)
  })

  it('is null when rejected but resetsAt is missing', () => {
    const info: RateLimitInfo = { status: 'rejected' }
    expect(rateLimitResetsAtMs(info)).toBeNull()
  })
})

describe('isRateLimited', () => {
  it('is false with no info', () => {
    expect(isRateLimited(null, Date.now())).toBe(false)
  })

  it('is true while now is before the rejected resetsAt', () => {
    const info: RateLimitInfo = { status: 'rejected', resetsAt: 1000 }
    expect(isRateLimited(info, 999_000)).toBe(true)
  })

  it('is false once now reaches or passes the rejected resetsAt', () => {
    const info: RateLimitInfo = { status: 'rejected', resetsAt: 1000 }
    expect(isRateLimited(info, 1_000_000)).toBe(false)
    expect(isRateLimited(info, 1_000_001)).toBe(false)
  })

  it('is false for allowed_warning even at high utilization', () => {
    const info: RateLimitInfo = { status: 'allowed_warning', utilization: 0.98 }
    expect(isRateLimited(info, Date.now())).toBe(false)
  })
})
