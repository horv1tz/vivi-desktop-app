import { afterEach, describe, expect, it, vi } from 'vitest'

const runMock = vi.fn<(cmd: string, args: string[], opts?: unknown) => Promise<{ code: number; stdout: string; stderr: string }>>()
const powershellMock = vi.fn<(script: string, timeoutMs?: number, env?: Record<string, string>) => Promise<{ code: number; stdout: string; stderr: string }>>()

vi.mock('electron', () => ({ clipboard: { readText: vi.fn(async () => ''), writeText: vi.fn(async () => undefined) } }))
vi.mock('../../../src/main/agent/tools/util', () => ({ run: runMock, powershell: powershellMock, truncate: (s: string) => s }))
vi.mock('../../../src/main/agent/tools/windows-list', () => ({ listWindows: vi.fn(async () => []) }))

const ok = (stdout = ''): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout, stderr: '' })
const fail = (stderr = 'boom'): { code: number; stdout: string; stderr: string } => ({ code: 1, stdout: '', stderr })

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

const REAL_PLATFORM = process.platform
afterEach(() => {
  setPlatform(REAL_PLATFORM)
  runMock.mockReset()
  powershellMock.mockReset()
})

describe('NativeCliDriver — fail-safe cursor reporting', () => {
  it('throws (does not fake {0,0}) on darwin without cliclick, so InputGuard treats it as unknown rather than a corner', async () => {
    setPlatform('darwin')
    runMock.mockResolvedValue(fail()) // has('cliclick') -> false
    const { NativeCliDriver } = await import('../../../src/main/agent/tools/drivers/native-cli')
    const driver = new NativeCliDriver()
    await expect(driver.getMousePos()).rejects.toThrow(/cliclick/)
  })

  it('throws on Linux when neither xdotool nor ydotool can report the cursor', async () => {
    setPlatform('linux')
    runMock.mockImplementation(async (cmd: string) => (cmd === 'which' ? fail() : fail()))
    const { NativeCliDriver } = await import('../../../src/main/agent/tools/drivers/native-cli')
    const driver = new NativeCliDriver()
    await expect(driver.getMousePos()).rejects.toThrow(/ydotool/)
  })
})

describe('NativeCliDriver — exit codes are checked', () => {
  it('throws when xdotool mousemove fails instead of silently reporting success', async () => {
    setPlatform('linux')
    runMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'xdotool') return ok()
      if (cmd === 'xdotool' && args[0] === 'mousemove') return fail('no display')
      return ok()
    })
    const { NativeCliDriver } = await import('../../../src/main/agent/tools/drivers/native-cli')
    const driver = new NativeCliDriver()
    await expect(driver.moveMouse(10, 10)).rejects.toThrow(/no display|xdotool mousemove/)
  })
})

describe('NativeCliDriver — ydotool key names', () => {
  it('sends ydotool its own evdev keycodes, not xdotool X11 keysym names', async () => {
    setPlatform('linux')
    runMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'xdotool') return fail()
      if (cmd === 'which' && args[0] === 'ydotool') return ok()
      return ok()
    })
    const { NativeCliDriver } = await import('../../../src/main/agent/tools/drivers/native-cli')
    const driver = new NativeCliDriver()
    await driver.pressKeys(['ctrl', 'shift', 't'])
    const call = runMock.mock.calls.find(([cmd, args]) => cmd === 'ydotool' && args[0] === 'key')
    expect(call).toBeTruthy()
    // control=29, shift=42, t=20 (linux/input-event-codes.h) — pressed in order, released in reverse.
    expect(call![1].slice(1)).toEqual(['29:1', '42:1', '20:1', '20:0', '42:0', '29:0'])
  })

  it('rejects a key ydotool has no mapping for, rather than silently sending nothing', async () => {
    setPlatform('linux')
    runMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'xdotool') return fail()
      if (cmd === 'which' && args[0] === 'ydotool') return ok()
      return ok()
    })
    const { NativeCliDriver } = await import('../../../src/main/agent/tools/drivers/native-cli')
    const driver = new NativeCliDriver()
    await expect(driver.pressKeys(['f13'])).rejects.toThrow(/not supported/)
  })
})

describe('NativeCliDriver — Windows mouse button state', () => {
  it('implements mouseDown/mouseUp via mouse_event (drag() no longer no-ops on Windows)', async () => {
    setPlatform('win32')
    powershellMock.mockResolvedValue(ok())
    const { NativeCliDriver } = await import('../../../src/main/agent/tools/drivers/native-cli')
    const driver = new NativeCliDriver()
    await driver.mouseDown('left')
    await driver.mouseUp('left')
    expect(powershellMock).toHaveBeenCalledTimes(2)
    expect(powershellMock.mock.calls[0]![0]).toContain('mouse_event(2,')
    expect(powershellMock.mock.calls[1]![0]).toContain('mouse_event(4,')
  })

  it('minimizeWindow calls ShowWindow with SW_MINIMIZE', async () => {
    setPlatform('win32')
    powershellMock.mockResolvedValue(ok())
    vi.doMock('../../../src/main/agent/tools/windows-list', () => ({ listWindows: vi.fn(async () => [{ id: 42, title: 'x', app: 'x', pid: 1, bounds: { x: 0, y: 0, width: 0, height: 0 } }]) }))
    vi.resetModules()
    const { NativeCliDriver } = await import('../../../src/main/agent/tools/drivers/native-cli')
    const driver = new NativeCliDriver()
    const ok2 = await driver.minimizeWindow({ id: 42 })
    expect(ok2).toBe(true)
    expect(powershellMock.mock.calls.at(-1)?.[0]).toContain('ShowWindow([IntPtr]42, 6)')
  })
})
