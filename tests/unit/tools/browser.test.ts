import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn() }))
vi.mock('chrome-remote-interface', () => ({ default: vi.fn() }))

const { existsSync } = await import('node:fs')
const mockExistsSync = vi.mocked(existsSync)
const { candidateExecutables, commandExistsOnPath, findBrowserExecutable } =
  await import('../../../src/main/agent/tools/browser')

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}
const REAL_PLATFORM = process.platform
const REAL_PATH = process.env.PATH
const REAL_OVERRIDE = process.env.VIVI_BROWSER_BIN

afterEach(() => {
  setPlatform(REAL_PLATFORM)
  process.env.PATH = REAL_PATH
  delete process.env.VIVI_BROWSER_BIN
  if (REAL_OVERRIDE !== undefined) process.env.VIVI_BROWSER_BIN = REAL_OVERRIDE
  mockExistsSync.mockReset()
})

describe('candidateExecutables', () => {
  it('returns absolute app paths on macOS', () => {
    const list = candidateExecutables('darwin')
    expect(list.length).toBeGreaterThan(0)
    for (const c of list) expect(c).toMatch(/^\/Applications\//)
  })

  it('returns absolute .exe paths on Windows', () => {
    const list = candidateExecutables('win32')
    expect(list.length).toBeGreaterThan(0)
    for (const c of list) expect(c.toLowerCase()).toMatch(/\.exe$/)
  })

  it('returns bare command names on Linux, to be resolved against PATH', () => {
    const list = candidateExecutables('linux')
    expect(list).toContain('google-chrome-stable')
    expect(list).toContain('chromium')
    for (const c of list) expect(c).not.toMatch(/[/\\]/)
  })
})

describe('commandExistsOnPath', () => {
  it('finds a bare command in one of the PATH directories (posix)', () => {
    process.env.PATH = '/usr/local/bin:/usr/bin'
    mockExistsSync.mockImplementation((p) => p === '/usr/bin/chromium')
    expect(commandExistsOnPath('chromium', 'linux')).toBe(true)
    expect(commandExistsOnPath('nonexistent-browser', 'linux')).toBe(false)
  })

  it('also checks the .exe suffix on Windows', () => {
    // node:path's default `join` follows the host OS the tests run on, not a faked
    // process.platform — build the expected path with the same `join` the source uses, so this
    // test verifies the "also try + .exe" logic itself rather than a specific separator.
    process.env.PATH = 'C:\\tools'
    mockExistsSync.mockImplementation((p) => p === join('C:\\tools', 'chrome.exe'))
    expect(commandExistsOnPath('chrome', 'win32')).toBe(true)
  })
})

describe('findBrowserExecutable', () => {
  it('prefers VIVI_BROWSER_BIN when set and it exists on disk', () => {
    process.env.VIVI_BROWSER_BIN = '/custom/chrome'
    mockExistsSync.mockImplementation((p) => p === '/custom/chrome')
    expect(findBrowserExecutable()).toBe('/custom/chrome')
  })

  it('falls through to the platform candidates when VIVI_BROWSER_BIN does not exist', () => {
    setPlatform('darwin')
    process.env.VIVI_BROWSER_BIN = '/custom/chrome'
    mockExistsSync.mockImplementation(
      (p) => p === '/Applications/Chromium.app/Contents/MacOS/Chromium',
    )
    expect(findBrowserExecutable()).toBe('/Applications/Chromium.app/Contents/MacOS/Chromium')
  })

  it('returns null when nothing matches', () => {
    setPlatform('darwin')
    delete process.env.VIVI_BROWSER_BIN
    mockExistsSync.mockReturnValue(false)
    expect(findBrowserExecutable()).toBeNull()
  })

  it('resolves a bare Linux command against PATH', () => {
    setPlatform('linux')
    delete process.env.VIVI_BROWSER_BIN
    process.env.PATH = '/usr/bin'
    mockExistsSync.mockImplementation((p) => p === '/usr/bin/chromium-browser')
    expect(findBrowserExecutable()).toBe('chromium-browser')
  })
})
