import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeChecksums } from '../../../scripts/checksums.mjs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vivi-checksums-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('writeChecksums (SEC-07)', () => {
  it('hashes each installer file and writes a checksums file sorted by name', async () => {
    writeFileSync(join(dir, 'Vivi-1.0.0.exe'), 'exe-bytes')
    writeFileSync(join(dir, 'Vivi-1.0.0.dmg'), 'dmg-bytes')
    writeFileSync(join(dir, 'builder-effective-config.yaml'), 'not an installer')
    const { files, content } = await writeChecksums(dir, 'checksums.txt')
    expect(files).toEqual(['Vivi-1.0.0.dmg', 'Vivi-1.0.0.exe'])
    const exeHash = createHash('sha256').update('exe-bytes').digest('hex')
    const dmgHash = createHash('sha256').update('dmg-bytes').digest('hex')
    expect(content).toBe(`${dmgHash}  Vivi-1.0.0.dmg\n${exeHash}  Vivi-1.0.0.exe\n`)
    expect(readFileSync(join(dir, 'checksums.txt'), 'utf8')).toBe(content)
  })

  it('writes an empty file when there are no installer files', async () => {
    const { files, content } = await writeChecksums(dir, 'checksums.txt')
    expect(files).toEqual([])
    expect(content).toBe('')
  })
})
