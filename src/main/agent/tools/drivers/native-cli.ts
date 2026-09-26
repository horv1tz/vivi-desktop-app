import { clipboard } from 'electron'
import type { InputDriver, MouseButton } from '../input-driver'
import { parseCombo, primaryModifier } from '../keys'
import { listWindows, type WindowInfo } from '../windows-list'
import { powershell, run } from '../util'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Escapes a string for embedding inside a double-quoted AppleScript literal (backslash first, then
 * quote — reversing the order would let a trailing backslash swallow the following escaped quote and
 * re-open the literal to injected script text).
 */
function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function has(cmd: string): Promise<boolean> {
  const r = await run(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeoutMs: 5000 })
  return r.code === 0
}

function pickWindow(
  windows: WindowInfo[],
  target: { id?: number; title?: string; app?: string; pid?: number },
): WindowInfo | undefined {
  if (target.id !== undefined) return windows.find((w) => w.id === target.id)
  if (target.pid !== undefined) return windows.find((w) => w.pid === target.pid)
  const title = target.title?.toLowerCase()
  const app = target.app?.toLowerCase()
  return (
    windows.find(
      (w) =>
        (title ? w.title.toLowerCase() === title : false) ||
        (app ? w.app.toLowerCase() === app : false),
    ) ??
    windows.find(
      (w) =>
        (title ? w.title.toLowerCase().includes(title) : false) ||
        (app ? w.app.toLowerCase().includes(app) : false),
    )
  )
}

/** Shared window activation (used by both drivers). */
export async function focusWindowNative(
  target: { id?: number; title?: string; app?: string; pid?: number },
  list: () => Promise<WindowInfo[]>,
): Promise<boolean> {
  let win: WindowInfo | undefined
  try {
    win = pickWindow(await list(), target)
  } catch {
    win = undefined
  }
  if (process.platform === 'darwin') {
    if (win) {
      const r = await run('osascript', [
        '-e',
        `tell application "System Events" to set frontmost of (first process whose unix id is ${win.pid}) to true`,
      ])
      if (r.code === 0) return true
    }
    if (target.app) {
      const r = await run('osascript', [
        '-e',
        `tell application "${escapeAppleScriptString(target.app)}" to activate`,
      ])
      return r.code === 0
    }
    return false
  }
  if (process.platform === 'win32') {
    if (win) {
      const r = await powershell(
        `$sig='[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);'; $t=Add-Type -MemberDefinition $sig -Name W -Namespace U -PassThru; $h=[IntPtr]${win.id}; [void]$t::ShowWindow($h,9); [void]$t::SetForegroundWindow($h)`,
      )
      if (r.code === 0) return true
    }
    const name = target.title ?? target.app
    if (name) {
      const r = await powershell(
        '(New-Object -ComObject WScript.Shell).AppActivate($env:VIVI_TARGET_NAME)',
        20_000,
        { VIVI_TARGET_NAME: name },
      )
      return r.code === 0 && /True/i.test(r.stdout)
    }
    return false
  }
  if (win) {
    if (await has('xdotool'))
      return (await run('xdotool', ['windowactivate', '--sync', String(win.id)])).code === 0
    if (await has('wmctrl')) return (await run('wmctrl', ['-ia', String(win.id)])).code === 0
  }
  if ((target.title ?? target.app) && (await has('xdotool'))) {
    return (
      (
        await run('xdotool', [
          'search',
          '--name',
          target.title ?? target.app ?? '',
          'windowactivate',
          '--sync',
        ])
      ).code === 0
    )
  }
  return false
}

/**
 * Fallback driver built on OS command-line tools (no native modules):
 * macOS: osascript/cliclick · Windows: PowerShell · Linux: xdotool (X11) / ydotool (Wayland).
 */
export class NativeCliDriver implements InputDriver {
  readonly name = 'native-cli'
  private linuxTool: 'xdotool' | 'ydotool' | null | undefined

  private async linux(): Promise<'xdotool' | 'ydotool' | null> {
    if (this.linuxTool !== undefined) return this.linuxTool
    this.linuxTool = (await has('xdotool')) ? 'xdotool' : (await has('ydotool')) ? 'ydotool' : null
    return this.linuxTool
  }

  async available(): Promise<boolean> {
    if (process.platform === 'darwin') return has('osascript')
    if (process.platform === 'win32') return true
    return (await this.linux()) !== null
  }

  async getMousePos(): Promise<{ x: number; y: number }> {
    if (process.platform === 'win32') {
      const r = await powershell(
        'Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; "$($p.X),$($p.Y)"',
      )
      const [x, y] = r.stdout.trim().split(',').map(Number)
      return { x: x ?? 0, y: y ?? 0 }
    }
    if (process.platform === 'darwin') {
      if (await has('cliclick')) {
        const r = await run('cliclick', ['p'])
        expect(r, 'cliclick p')
        const [x, y] = r.stdout.trim().split(',').map(Number)
        return { x: x ?? 0, y: y ?? 0 }
      }
      // No way to read the cursor position: throwing (not a fake {0,0}, which InputGuard's fail-safe
      // would read as "cursor parked in the top-left corner" and abort every action) lets the caller's
      // `.catch(() => null)` correctly treat this as "position unknown, skip the corner check".
      throw new Error('reading the cursor position needs cliclick (brew install cliclick)')
    }
    const tool = await this.linux()
    if (tool === 'xdotool') {
      const r = await run('xdotool', ['getmouselocation', '--shell'])
      expect(r, 'xdotool getmouselocation')
      const x = Number(/X=(\d+)/.exec(r.stdout)?.[1] ?? 0)
      const y = Number(/Y=(\d+)/.exec(r.stdout)?.[1] ?? 0)
      return { x, y }
    }
    throw new Error(
      'ydotool cannot report the cursor position; fail-safe corner detection is unavailable with this driver',
    )
  }

  async moveMouse(x: number, y: number): Promise<void> {
    const X = Math.round(x)
    const Y = Math.round(y)
    if (process.platform === 'win32')
      expect(
        await powershell(
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${X},${Y})`,
        ),
        'move mouse',
      )
    else if (process.platform === 'darwin')
      expect(await run('cliclick', [`m:${X},${Y}`]), 'cliclick move')
    else if ((await this.linux()) === 'xdotool')
      expect(await run('xdotool', ['mousemove', String(X), String(Y)]), 'xdotool mousemove')
    else
      expect(
        await run('ydotool', ['mousemove', '--absolute', '-x', String(X), '-y', String(Y)]),
        'ydotool mousemove',
      )
  }

  async click(
    x: number | undefined,
    y: number | undefined,
    button: MouseButton,
    double: boolean,
  ): Promise<void> {
    if (x !== undefined && y !== undefined) await this.moveMouse(x, y)
    if (process.platform === 'win32') {
      const down = button === 'right' ? 0x08 : button === 'middle' ? 0x20 : 0x02
      const up = down << 1
      const seq = double ? [down, up, down, up] : [down, up]
      expect(
        await powershell(
          `$sig='[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);'; $m=Add-Type -MemberDefinition $sig -Name M -Namespace U -PassThru; ${seq.map((f) => `$m::mouse_event(${f},0,0,0,0)`).join('; ')}`,
        ),
        'click',
      )
    } else if (process.platform === 'darwin') {
      const cmd = button === 'right' ? 'rc' : double ? 'dc' : 'c'
      expect(await run('cliclick', [`${cmd}:.`]), 'cliclick click')
    } else if ((await this.linux()) === 'xdotool') {
      const b = button === 'right' ? '3' : button === 'middle' ? '2' : '1'
      expect(
        await run('xdotool', ['click', ...(double ? ['--repeat', '2', '--delay', '80'] : []), b]),
        'xdotool click',
      )
    } else {
      const code = button === 'right' ? '0xC1' : button === 'middle' ? '0xC2' : '0xC0'
      expect(await run('ydotool', ['click', ...(double ? [code, code] : [code])]), 'ydotool click')
    }
    await sleep(60)
  }

  private static readonly WIN_MOUSE_EVENT =
    '[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);'

  async mouseDown(button: MouseButton): Promise<void> {
    if (process.platform === 'win32') {
      const down = button === 'right' ? 0x08 : button === 'middle' ? 0x20 : 0x02
      expect(
        await powershell(
          `$m=Add-Type -MemberDefinition '${NativeCliDriver.WIN_MOUSE_EVENT}' -Name Md -Namespace U -PassThru; $m::mouse_event(${down},0,0,0,0)`,
        ),
        'mouse down',
      )
      return
    }
    if (process.platform === 'darwin') {
      expect(await run('cliclick', ['dd:.']), 'cliclick down')
      return
    }
    const tool = await this.linux()
    if (tool === 'xdotool')
      expect(
        await run('xdotool', [
          'mousedown',
          button === 'right' ? '3' : button === 'middle' ? '2' : '1',
        ]),
        'xdotool mousedown',
      )
    else
      throw new Error(
        'holding the mouse button down needs xdotool (X11); ydotool has no equivalent',
      )
  }

  async mouseUp(button: MouseButton): Promise<void> {
    if (process.platform === 'win32') {
      const down = button === 'right' ? 0x08 : button === 'middle' ? 0x20 : 0x02
      const up = down << 1
      expect(
        await powershell(
          `$m=Add-Type -MemberDefinition '${NativeCliDriver.WIN_MOUSE_EVENT}' -Name Mu -Namespace U -PassThru; $m::mouse_event(${up},0,0,0,0)`,
        ),
        'mouse up',
      )
      return
    }
    if (process.platform === 'darwin') {
      expect(await run('cliclick', ['du:.']), 'cliclick up')
      return
    }
    const tool = await this.linux()
    if (tool === 'xdotool')
      expect(
        await run('xdotool', [
          'mouseup',
          button === 'right' ? '3' : button === 'middle' ? '2' : '1',
        ]),
        'xdotool mouseup',
      )
    else
      throw new Error('releasing the mouse button needs xdotool (X11); ydotool has no equivalent')
  }

  async drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    button: MouseButton,
  ): Promise<void> {
    if (process.platform === 'darwin') {
      await run('cliclick', [
        `dd:${Math.round(from.x)},${Math.round(from.y)}`,
        `du:${Math.round(to.x)},${Math.round(to.y)}`,
      ])
      return
    }
    await this.moveMouse(from.x, from.y)
    await this.mouseDown(button)
    await this.moveMouse(to.x, to.y)
    await this.mouseUp(button)
  }

  async scroll(dx: number, dy: number): Promise<void> {
    if (process.platform === 'win32') {
      expect(
        await powershell(
          `$sig='[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);'; $m=Add-Type -MemberDefinition $sig -Name S -Namespace U -PassThru; $m::mouse_event(0x0800,0,0,${Math.round(-dy * 120)},0)`,
        ),
        'scroll',
      )
    } else if ((await this.linux()) === 'xdotool') {
      const btn = dy > 0 ? '5' : '4'
      expect(
        await run('xdotool', [
          'click',
          '--repeat',
          String(Math.max(1, Math.abs(Math.round(dy)))),
          btn,
        ]),
        'xdotool scroll',
      )
    } else if (process.platform === 'darwin' && (await has('cliclick'))) {
      // cliclick has no scroll; fall back to keyboard arrows.
      for (let i = 0; i < Math.abs(Math.round(dy)); i++)
        await this.pressKeys([dy > 0 ? 'down' : 'up'])
    } else {
      throw new Error('scrolling needs xdotool (Linux) — no equivalent via ydotool yet')
    }
  }

  async typeText(text: string): Promise<void> {
    const previous = await clipboard.readText().catch(() => '')
    await clipboard.writeText(text)
    await sleep(40)
    await this.pressKeys([primaryModifier(), 'v'])
    await sleep(120)
    if (previous) await clipboard.writeText(previous).catch(() => undefined)
  }

  async pressKeys(keys: string[]): Promise<void> {
    const { modifiers, key } = parseCombo(keys)
    if (process.platform === 'darwin') {
      const macMods = modifiers
        .map(
          (m) =>
            ({
              control: 'control down',
              command: 'command down',
              alt: 'option down',
              shift: 'shift down',
            })[m],
        )
        .filter(Boolean)
      const code = MAC_KEYCODES[key]
      const using = macMods.length ? ` using {${macMods.join(', ')}}` : ''
      const script =
        code !== undefined
          ? `tell application "System Events" to key code ${code}${using}`
          : `tell application "System Events" to keystroke "${escapeAppleScriptString(key)}"${using}`
      expect(await run('osascript', ['-e', script]), 'keystroke')
      return
    }
    if (process.platform === 'win32') {
      const mods = modifiers
        .map((m) => ({ control: '^', alt: '%', shift: '+', command: '' })[m] ?? '')
        .join('')
      const special = WIN_SENDKEYS[key]
      const k =
        special ??
        (key.length === 1
          ? key.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`)
          : `{${key.toUpperCase()}}`)
      expect(
        await powershell(
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait($env:VIVI_SENDKEYS)',
          20_000,
          { VIVI_SENDKEYS: mods + k },
        ),
        'press keys',
      )
      return
    }
    const tool = await this.linux()
    if (tool === 'xdotool') {
      const combo = [
        ...modifiers.map(
          (m) => ({ control: 'ctrl', command: 'super', alt: 'alt', shift: 'shift' })[m] ?? m,
        ),
        X11_KEYS[key] ?? key,
      ].join('+')
      expect(await run('xdotool', ['key', '--clearmodifiers', combo]), 'xdotool key')
      return
    }
    if (tool === 'ydotool') {
      expect(await ydotoolPressCombo([...modifiers, key]), 'ydotool key')
      return
    }
    throw new Error('no input tool available (install xdotool or ydotool)')
  }

  async focusWindow(target: {
    id?: number
    title?: string
    app?: string
    pid?: number
  }): Promise<boolean> {
    return focusWindowNative(target, listWindows)
  }

  async minimizeWindow(target: {
    id?: number
    title?: string
    app?: string
    pid?: number
  }): Promise<boolean> {
    const win = pickWindow(await listWindows().catch(() => []), target)
    if (process.platform === 'win32' && win) {
      const r = await powershell(
        `$sig='[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);'; $t=Add-Type -MemberDefinition $sig -Name Wm -Namespace U -PassThru; [void]$t::ShowWindow([IntPtr]${win.id}, 6)`,
      )
      return r.code === 0
    }
    if (process.platform === 'darwin') {
      const ok = await this.focusWindow(target)
      if (!ok) return false
      await this.pressKeys(['command', 'm'])
      return true
    }
    if (win && (await this.linux()) === 'xdotool') {
      const r = await run('xdotool', ['windowminimize', String(win.id)])
      return r.code === 0
    }
    return false
  }
}

const MAC_KEYCODES: Record<string, number> = {
  enter: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
}

/**
 * Linux evdev keycodes (linux/input-event-codes.h — a stable kernel ABI). ydotool's `key` subcommand
 * takes raw `CODE:1`/`CODE:0` press/release pairs, unlike xdotool's X11 keysym names, so it needs its
 * own table instead of reusing X11_KEYS (X11 keysym names like "Return" are meaningless to ydotool).
 */
const LINUX_KEYCODES: Record<string, number> = {
  escape: 1,
  '1': 2,
  '2': 3,
  '3': 4,
  '4': 5,
  '5': 6,
  '6': 7,
  '7': 8,
  '8': 9,
  '9': 10,
  '0': 11,
  minus: 12,
  equals: 13,
  backspace: 14,
  tab: 15,
  q: 16,
  w: 17,
  e: 18,
  r: 19,
  t: 20,
  y: 21,
  u: 22,
  i: 23,
  o: 24,
  p: 25,
  bracketleft: 26,
  bracketright: 27,
  enter: 28,
  control: 29,
  a: 30,
  s: 31,
  d: 32,
  f: 33,
  g: 34,
  h: 35,
  j: 36,
  k: 37,
  l: 38,
  semicolon: 39,
  quote: 40,
  grave: 41,
  shift: 42,
  backslash: 43,
  z: 44,
  x: 45,
  c: 46,
  v: 47,
  b: 48,
  n: 49,
  m: 50,
  comma: 51,
  period: 52,
  slash: 53,
  alt: 56,
  space: 57,
  capslock: 58,
  f1: 59,
  f2: 60,
  f3: 61,
  f4: 62,
  f5: 63,
  f6: 64,
  f7: 65,
  f8: 66,
  f9: 67,
  f10: 68,
  numlock: 69,
  printscreen: 99,
  home: 102,
  up: 103,
  pageup: 104,
  left: 105,
  right: 106,
  end: 107,
  down: 108,
  pagedown: 109,
  insert: 110,
  delete: 111,
  f11: 87,
  f12: 88,
  command: 125,
}

/** Presses (then releases, in reverse order) a combo of keys through ydotool's raw keycode syntax. */
async function ydotoolPressCombo(
  keys: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const codes = keys.map((k) => LINUX_KEYCODES[k])
  const missing = keys.find((_, i) => codes[i] === undefined)
  if (missing !== undefined)
    throw new Error(`key not supported by the ydotool fallback: "${missing}"`)
  const seq = [...codes.map((c) => `${c}:1`), ...[...codes].reverse().map((c) => `${c}:0`)]
  return run('ydotool', ['key', ...seq])
}

function expect(r: { code: number; stderr: string }, what: string): void {
  if (r.code !== 0) throw new Error(r.stderr.trim() || `${what} failed (exit code ${r.code})`)
}
const WIN_SENDKEYS: Record<string, string> = {
  enter: '{ENTER}',
  tab: '{TAB}',
  escape: '{ESC}',
  backspace: '{BACKSPACE}',
  delete: '{DELETE}',
  space: ' ',
  up: '{UP}',
  down: '{DOWN}',
  left: '{LEFT}',
  right: '{RIGHT}',
  home: '{HOME}',
  end: '{END}',
  pageup: '{PGUP}',
  pagedown: '{PGDN}',
  insert: '{INSERT}',
  printscreen: '{PRTSC}',
  f1: '{F1}',
  f2: '{F2}',
  f3: '{F3}',
  f4: '{F4}',
  f5: '{F5}',
  f6: '{F6}',
  f7: '{F7}',
  f8: '{F8}',
  f9: '{F9}',
  f10: '{F10}',
  f11: '{F11}',
  f12: '{F12}',
}
const X11_KEYS: Record<string, string> = {
  enter: 'Return',
  escape: 'Escape',
  backspace: 'BackSpace',
  delete: 'Delete',
  tab: 'Tab',
  space: 'space',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'Prior',
  pagedown: 'Next',
  insert: 'Insert',
  printscreen: 'Print',
  plus: 'plus',
  minus: 'minus',
  equals: 'equal',
  comma: 'comma',
  period: 'period',
  slash: 'slash',
  backslash: 'backslash',
  semicolon: 'semicolon',
  quote: 'apostrophe',
  grave: 'grave',
  bracketleft: 'bracketleft',
  bracketright: 'bracketright',
}
