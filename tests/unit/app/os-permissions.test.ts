import { afterEach, describe, expect, it, vi } from 'vitest'

const runMock =
  vi.fn<
    (
      cmd: string,
      args: string[],
      opts?: unknown,
    ) => Promise<{ code: number; stdout: string; stderr: string }>
  >()
const openExternalMock = vi.fn(async () => undefined)
const getMediaAccessStatusMock = vi.fn(() => 'granted' as const)
const isTrustedAccessibilityClientMock = vi.fn(() => true)
const askForMediaAccessMock = vi.fn(async () => true)

vi.mock('../../../src/main/agent/tools/util', () => ({ run: runMock }))
vi.mock('electron', () => ({
  shell: { openExternal: openExternalMock },
  systemPreferences: {
    getMediaAccessStatus: getMediaAccessStatusMock,
    isTrustedAccessibilityClient: isTrustedAccessibilityClientMock,
    askForMediaAccess: askForMediaAccessMock,
  },
}))

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

const REAL_PLATFORM = process.platform
afterEach(() => {
  setPlatform(REAL_PLATFORM)
  runMock.mockReset()
  openExternalMock.mockClear()
})

describe('getOsPermissions — automation (CU-06)', () => {
  it('reports granted when the System Events probe succeeds', async () => {
    setPlatform('darwin')
    runMock.mockResolvedValue({ code: 0, stdout: 'Finder', stderr: '' })
    const { getOsPermissions } = await import('../../../src/main/app/os-permissions')
    const perms = await getOsPermissions()
    expect(perms.automation).toBe('granted')
  })

  it('reports denied on the specific macOS "not authorized" error', async () => {
    setPlatform('darwin')
    runMock.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'execution error: Not authorized to send Apple events to System Events. (-1743)',
    })
    const { getOsPermissions } = await import('../../../src/main/app/os-permissions')
    const perms = await getOsPermissions()
    expect(perms.automation).toBe('denied')
  })

  it('reports unknown (not denied) on an inconclusive failure, e.g. a timeout', async () => {
    setPlatform('darwin')
    runMock.mockResolvedValue({ code: 1, stdout: '', stderr: 'osascript: command timed out' })
    const { getOsPermissions } = await import('../../../src/main/app/os-permissions')
    const perms = await getOsPermissions()
    expect(perms.automation).toBe('unknown')
  })

  it('is n/a on Windows and Linux, never probing osascript', async () => {
    setPlatform('win32')
    const { getOsPermissions } = await import('../../../src/main/app/os-permissions')
    expect((await getOsPermissions()).automation).toBe('n/a')
    setPlatform('linux')
    expect((await getOsPermissions()).automation).toBe('n/a')
    expect(runMock).not.toHaveBeenCalled()
  })
})

describe('requestOsPermission — automation (CU-06)', () => {
  it('returns true and does not open System Settings when already granted', async () => {
    setPlatform('darwin')
    runMock.mockResolvedValue({ code: 0, stdout: 'Finder', stderr: '' })
    const { requestOsPermission } = await import('../../../src/main/app/os-permissions')
    expect(await requestOsPermission('automation')).toBe(true)
    expect(openExternalMock).not.toHaveBeenCalled()
  })

  it('opens the Automation privacy pane when not granted', async () => {
    setPlatform('darwin')
    runMock.mockResolvedValue({ code: 1, stdout: '', stderr: '-1743' })
    const { requestOsPermission } = await import('../../../src/main/app/os-permissions')
    expect(await requestOsPermission('automation')).toBe(false)
    expect(openExternalMock).toHaveBeenCalledWith(expect.stringContaining('Privacy_Automation'))
  })
})

describe('checkInputPermission — pre-flight gate before an input action (CU-06)', () => {
  it('is always ok on non-macOS platforms, without touching Accessibility or Automation', async () => {
    setPlatform('win32')
    const { checkInputPermission } = await import('../../../src/main/app/os-permissions')
    expect(await checkInputPermission('pointer')).toEqual({ ok: true })
    expect(await checkInputPermission('window')).toEqual({ ok: true })
    expect(isTrustedAccessibilityClientMock).not.toHaveBeenCalled()
    expect(runMock).not.toHaveBeenCalled()
  })

  it('blocks a pointer action with an actionable message when Accessibility is denied', async () => {
    setPlatform('darwin')
    isTrustedAccessibilityClientMock.mockReturnValueOnce(false)
    const { checkInputPermission } = await import('../../../src/main/app/os-permissions')
    const result = await checkInputPermission('pointer')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/Accessibility/)
    // Automation is never probed once Accessibility already failed — no need for the extra subprocess.
    expect(runMock).not.toHaveBeenCalled()
  })

  it('allows a pointer action once Accessibility is granted, without probing Automation at all', async () => {
    setPlatform('darwin')
    isTrustedAccessibilityClientMock.mockReturnValueOnce(true)
    const { checkInputPermission } = await import('../../../src/main/app/os-permissions')
    expect(await checkInputPermission('pointer')).toEqual({ ok: true })
    expect(runMock).not.toHaveBeenCalled()
  })

  it('blocks a window action with an actionable message when Automation is denied', async () => {
    setPlatform('darwin')
    isTrustedAccessibilityClientMock.mockReturnValueOnce(true)
    runMock.mockResolvedValue({ code: 1, stdout: '', stderr: '-1743' })
    const { checkInputPermission } = await import('../../../src/main/app/os-permissions')
    const result = await checkInputPermission('window')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/Automation/)
  })

  it('allows a window action when both Accessibility and Automation are granted', async () => {
    setPlatform('darwin')
    isTrustedAccessibilityClientMock.mockReturnValueOnce(true)
    runMock.mockResolvedValue({ code: 0, stdout: 'Finder', stderr: '' })
    const { checkInputPermission } = await import('../../../src/main/app/os-permissions')
    expect(await checkInputPermission('window')).toEqual({ ok: true })
  })

  it('allows a window action when Automation status is merely inconclusive, not denied', async () => {
    setPlatform('darwin')
    isTrustedAccessibilityClientMock.mockReturnValueOnce(true)
    runMock.mockResolvedValue({ code: 1, stdout: '', stderr: 'osascript: command timed out' })
    const { checkInputPermission } = await import('../../../src/main/app/os-permissions')
    expect(await checkInputPermission('window')).toEqual({ ok: true })
  })
})
