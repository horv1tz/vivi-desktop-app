import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
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

  // Regression test for a release-blocking bug (found cutting 0.2.0): the script's "am I the CLI
  // entry point, not just imported" check used to compare `import.meta.url` against a manually
  // built `file://${process.argv[1]}` string, which never matches on Windows (backslash paths,
  // missing leading slash before the drive letter) — the whole CLI branch silently never ran there,
  // so `node scripts/checksums.mjs dist out.txt` exited 0 without writing anything. Only a real
  // subprocess invocation exercises that branch; calling writeChecksums() directly, as the tests
  // above do, does not.
  it('actually writes the output file when run as a CLI subprocess, not just when imported', () => {
    writeFileSync(join(dir, 'Vivi-1.0.0.exe'), 'exe-bytes')
    execFileSync(process.execPath, [
      join(__dirname, '../../../scripts/checksums.mjs'),
      dir,
      'checksums.txt',
    ])
    const exeHash = createHash('sha256').update('exe-bytes').digest('hex')
    expect(readFileSync(join(dir, 'checksums.txt'), 'utf8')).toBe(`${exeHash}  Vivi-1.0.0.exe\n`)
  })
})
