import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findCandidates } from '../../../scripts/verify-dist.mjs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vivi-verify-dist-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('findCandidates (QA-02: macOS nested .app bundle)', () => {
  it('finds a top-level *-unpacked directory (Linux/Windows targets)', () => {
    mkdirSync(join(dir, 'linux-unpacked'))
    mkdirSync(join(dir, 'win-unpacked'))
    expect(findCandidates(dir).sort()).toEqual(
      [join(dir, 'linux-unpacked'), join(dir, 'win-unpacked')].sort(),
    )
  })

  it('finds a top-level .app bundle', () => {
    mkdirSync(join(dir, 'Vivi.app'))
    expect(findCandidates(dir)).toEqual([join(dir, 'Vivi.app')])
  })

  it('finds a .app bundle nested one level down, as produced by electron-builder --mac dir', () => {
    mkdirSync(join(dir, 'mac-arm64', 'Vivi.app'), { recursive: true })
    expect(findCandidates(dir)).toEqual([join(dir, 'mac-arm64', 'Vivi.app')])
  })

  it('ignores unrelated top-level directories and files', () => {
    mkdirSync(join(dir, 'builder-effective-config.yaml'))
    mkdirSync(join(dir, '.verify-config'))
    expect(findCandidates(dir)).toEqual([])
  })

  it('returns an empty list when the dist directory does not exist', () => {
    expect(findCandidates(join(dir, 'nope'))).toEqual([])
  })
})
