import { clipboard } from 'electron'
import type { InputDriver, MouseButton } from '../input-driver'
import { parseCombo, primaryModifier } from '../keys'
import { listWindows, type WindowInfo } from '../windows-list'
import { powershell, run } from '../util'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function has(cmd: string): Promise<boolean> {
  const r = await run(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeoutMs: 5000 })
  return r.code === 0
}

function pickWindow(windows: WindowInfo[], target: { id?: number; title?: string; app?: string; pid?: number }): WindowInfo | undefined {
  if (target.id !== undefined) return windows.find((w) => w.id === target.id)
  if (target.pid !== undefined) return windows.find((w) => w.pid === target.pid)
  const title = target.title?.toLowerCase()
  const app = target.app?.toLowerCase()
  return (
    windows.find((w) => (title ? w.title.toLowerCase() === title : false) || (app ? w.app.toLowerCase() === app : false)) ??
    windows.find((w) => (title ? w.title.toLowerCase().includes(title) : false) || (app ? w.app.toLowerCase().includes(app) : false))
  )
}

/** Shared window activation (used by both drivers). */
export async function focusWindowNative(target: { id?: number; title?: string; app?: string; pid?: number }, list: () => Promise<WindowInfo[]>): Promise<boolean> {
  let win: WindowInfo | undefined
  try {
    win = pickWindow(await list(), target)
  } catch {
    win = undefined
  }
  if (process.platform === 'darwin') {
    if (win) {
      const r = await run('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${win.pid}) to true`])
      if (r.code === 0) return true
    }
    if (target.app) {
      const r = await run('osascript', ['-e', `tell application "${target.app.replace(/"/g, '\\"')}" to activate`])
      return r.code === 0
    }
    return false
  }
  if (process.platform === 'win32') {
    if (win) {
      const r = await powershell(`$sig='[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);'; $t=Add-Type -MemberDefinition $sig -Name W -Namespace U -PassThru; $h=[IntPtr]${win.id}; [void]$t::ShowWindow($h,9); [void]$t::SetForegroundWindow($h)`)
      if (r.code === 0) return true
    }
    const name = target.title ?? target.app
    if (name) {
      const r = await powershell(`(New-Object -ComObject WScript.Shell).AppActivate(${JSON.stringify(name)})`)
      return r.code === 0 && /True/i.test(r.stdout)
    }
    return false
  }
  if (win) {
    if (await has('xdotool')) return (await run('xdotool', ['windowactivate', '--sync', String(win.id)])).code === 0
    if (await has('wmctrl')) return (await run('wmctrl', ['-ia', String(win.id)])).code === 0
  }
  if ((target.title ?? target.app) && (await has('xdotool'))) {
    return (await run('xdotool', ['search', '--name', target.title ?? target.app ?? '', 'windowactivate', '--sync'])).code === 0
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
      const r = await powershell('Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; "$($p.X),$($p.Y)"')
      const [x, y] = r.stdout.trim().split(',').map(Number)
      return { x: x ?? 0, y: y ?? 0 }
    }
    if (process.platform === 'darwin') {
      if (await has('cliclick')) {
        const r = await run('cliclick', ['p'])
        const [x, y] = r.stdout.trim().split(',').map(Number)
        return { x: x ?? 0, y: y ?? 0 }
      }
      return { x: 0, y: 0 }
    }
    const tool = await this.linux()
    if (tool === 'xdotool') {
      const r = await run('xdotool', ['getmouselocation', '--shell'])
      const x = Number(/X=(\d+)/.exec(r.stdout)?.[1] ?? 0)
      const y = Number(/Y=(\d+)/.exec(r.stdout)?.[1] ?? 0)
      return { x, y }
    }
    return { x: 0, y: 0 }
  }

  async moveMouse(x: number, y: number): Promise<void> {
    const X = Math.round(x)
    const Y = Math.round(y)
    if (process.platform === 'win32') await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${X},${Y})`)
    else if (process.platform === 'darwin') await run('cliclick', [`m:${X},${Y}`])
    else if ((await this.linux()) === 'xdotool') await run('xdotool', ['mousemove', String(X), String(Y)])
    else await run('ydotool', ['mousemove', '--absolute', '-x', String(X), '-y', String(Y)])
  }

  async click(x: number | undefined, y: number | undefined, button: MouseButton, double: boolean): Promise<void> {
    if (x !== undefined && y !== undefined) await this.moveMouse(x, y)
    if (process.platform === 'win32') {
      const down = button === 'right' ? 0x08 : button === 'middle' ? 0x20 : 0x02
      const up = down << 1
      const seq = double ? [down, up, down, up] : [down, up]
      await powershell(`$sig='[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);'; $m=Add-Type -MemberDefinition $sig -Name M -Namespace U -PassThru; ${seq.map((f) => `$m::mouse_event(${f},0,0,0,0)`).join('; ')}`)
    } else if (process.platform === 'darwin') {
      const cmd = button === 'right' ? 'rc' : double ? 'dc' : 'c'
      await run('cliclick', [`${cmd}:.`])
    } else if ((await this.linux()) === 'xdotool') {
      const b = button === 'right' ? '3' : button === 'middle' ? '2' : '1'
      await run('xdotool', ['click', ...(double ? ['--repeat', '2', '--delay', '80'] : []), b])
    } else {
      const code = button === 'right' ? '0xC1' : button === 'middle' ? '0xC2' : '0xC0'
      await run('ydotool', ['click', ...(double ? [code, code] : [code])])
    }
    await sleep(60)
  }

  async mouseDown(button: MouseButton): Promise<void> {
    if (process.platform === 'darwin') await run('cliclick', ['dd:.'])
    else if ((await this.linux()) === 'xdotool') await run('xdotool', ['mousedown', button === 'right' ? '3' : '1'])
  }

  async mouseUp(button: MouseButton): Promise<void> {
    if (process.platform === 'darwin') await run('cliclick', ['du:.'])
    else if ((await this.linux()) === 'xdotool') await run('xdotool', ['mouseup', button === 'right' ? '3' : '1'])
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }, button: MouseButton): Promise<void> {
    if (process.platform === 'darwin') {
      await run('cliclick', [`dd:${Math.round(from.x)},${Math.round(from.y)}`, `du:${Math.round(to.x)},${Math.round(to.y)}`])
      return
    }
    await this.moveMouse(from.x, from.y)
    await this.mouseDown(button)
    await this.moveMouse(to.x, to.y)
    await this.mouseUp(button)
  }

  async scroll(dx: number, dy: number): Promise<void> {
    if (process.platform === 'win32') {
      await powershell(`$sig='[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);'; $m=Add-Type -MemberDefinition $sig -Name S -Namespace U -PassThru; $m::mouse_event(0x0800,0,0,${Math.round(-dy * 120)},0)`)
    } else if ((await this.linux()) === 'xdotool') {
      const btn = dy > 0 ? '5' : '4'
      await run('xdotool', ['click', '--repeat', String(Math.max(1, Math.abs(Math.round(dy)))), btn])
    } else if (process.platform === 'darwin' && (await has('cliclick'))) {
      // cliclick has no scroll; fall back to keyboard arrows.
      for (let i = 0; i < Math.abs(Math.round(dy)); i++) await this.pressKeys([dy > 0 ? 'down' : 'up'])
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
      const macMods = modifiers.map((m) => ({ control: 'control down', command: 'command down', alt: 'option down', shift: 'shift down' })[m]).filter(Boolean)
      const code = MAC_KEYCODES[key]
      const using = macMods.length ? ` using {${macMods.join(', ')}}` : ''
      const script = code !== undefined ? `tell application "System Events" to key code ${code}${using}` : `tell application "System Events" to keystroke "${key.replace(/"/g, '\\"')}"${using}`
      await run('osascript', ['-e', script])
      return
    }
    if (process.platform === 'win32') {
      const mods = modifiers.map((m) => ({ control: '^', alt: '%', shift: '+', command: '' })[m] ?? '').join('')
      const special = WIN_SENDKEYS[key]
      const k = special ?? (key.length === 1 ? key.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`) : `{${key.toUpperCase()}}`)
      await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(mods + k)})`)
      return
    }
    const tool = await this.linux()
    const combo = [...modifiers.map((m) => ({ control: 'ctrl', command: 'super', alt: 'alt', shift: 'shift' })[m] ?? m), X11_KEYS[key] ?? key].join('+')
    if (tool === 'xdotool') await run('xdotool', ['key', '--clearmodifiers', combo])
    else if (tool === 'ydotool') await run('ydotool', ['key', combo])
  }

  async focusWindow(target: { id?: number; title?: string; app?: string; pid?: number }): Promise<boolean> {
    return focusWindowNative(target, listWindows)
  }
}

const MAC_KEYCODES: Record<string, number> = { enter: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121, f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111 }
const WIN_SENDKEYS: Record<string, string> = { enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}', backspace: '{BACKSPACE}', delete: '{DELETE}', space: ' ', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}', insert: '{INSERT}', printscreen: '{PRTSC}', f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}' }
const X11_KEYS: Record<string, string> = { enter: 'Return', escape: 'Escape', backspace: 'BackSpace', delete: 'Delete', tab: 'Tab', space: 'space', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next', insert: 'Insert', printscreen: 'Print', plus: 'plus', minus: 'minus', equals: 'equal', comma: 'comma', period: 'period', slash: 'slash', backslash: 'backslash', semicolon: 'semicolon', quote: 'apostrophe', grave: 'grave', bracketleft: 'bracketleft', bracketright: 'bracketright' }
