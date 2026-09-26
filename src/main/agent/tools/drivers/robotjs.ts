import { clipboard, screen } from 'electron'
import type { InputDriver, MouseButton } from '../input-driver'
import { parseCombo, primaryModifier } from '../keys'
import { listWindows } from '../windows-list'
import { focusWindowNative } from './native-cli'

type RobotJs = {
  moveMouse(x: number, y: number): void
  moveMouseSmooth(x: number, y: number, speed?: number): void
  mouseClick(button?: string, double?: boolean): void
  mouseToggle(down?: string, button?: string): void
  dragMouse(x: number, y: number): void
  scrollMouse(x: number, y: number): void
  typeString(s: string): void
  typeStringDelayed?(s: string, cpm: number): void
  keyTap(key: string, modifier?: string | string[]): void
  keyToggle(key: string, down: string, modifier?: string | string[]): void
  getMousePos(): { x: number; y: number }
  getScreenSize(): { width: number; height: number }
  setMouseDelay(ms: number): void
  setKeyboardDelay(ms: number): void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** robotjs 0.9 keys differ slightly from our canonical names. */
const KEY_MAP: Record<string, string> = { escape: 'escape', pageup: 'pageup', pagedown: 'pagedown', printscreen: 'printscreen', plus: '+', minus: '-', equals: '=', comma: ',', period: '.', slash: '/', backslash: '\\', semicolon: ';', quote: "'", grave: '`', bracketleft: '[', bracketright: ']', command: 'command', control: 'control' }

/**
 * Mouse/keyboard driver on top of robotjs (N-API prebuilds). Coordinates are logical screen
 * pixels. On Windows, whether robotjs's own coordinate space matches Electron's per-monitor-DPI
 * logical space (no scaling needed — true when the robotjs build declares Per-Monitor-V2 DPI
 * awareness) or lags behind it (needs each display's scaleFactor applied) isn't knowable from the
 * package alone, and gets it wrong on secondary monitors with a different scale than the primary if
 * assumed. `calibrate()` samples the real cursor through both APIs once, at whatever position it
 * already is, and picks whichever mode actually matches — instead of guessing.
 */
export class RobotJsDriver implements InputDriver {
  readonly name = 'robotjs'
  private robot: RobotJs | null = null
  private loadError: string | null = null
  private scaleMode: 'none' | 'perDisplayScale' | null = null

  private async load(): Promise<RobotJs> {
    if (this.robot) return this.robot
    if (this.loadError) throw new Error(this.loadError)
    try {
      const mod = (await import('robotjs')) as unknown as RobotJs & { default?: RobotJs }
      this.robot = (mod.default ?? mod) as RobotJs
      this.robot.setMouseDelay(2)
      this.robot.setKeyboardDelay(8)
      return this.robot
    } catch (err) {
      this.loadError = `robotjs unavailable: ${(err as Error).message}`
      throw new Error(this.loadError, { cause: err })
    }
  }

  async available(): Promise<boolean> {
    try {
      await this.load()
      return true
    } catch {
      return false
    }
  }

  /**
   * Runs once on Windows: compares robotjs's own idea of the current cursor position against
   * Electron's (both read the SAME physical cursor, no movement involved) to detect whether robotjs
   * already reports Electron-logical coordinates (mode 'none') or needs the per-display scale factor
   * applied (mode 'perDisplayScale', the previous unconditional behavior — still the fallback when
   * the two disagree in some other way, since it is at least correct for a single, unscaled display).
   * NOTE: this only calibrates against the display the cursor is CURRENTLY on; a multi-monitor setup
   * with genuinely mixed DPI still has residual origin error on other displays (see docs/ROADMAP.md
   * epic CU-04) — this fixes the overwhelmingly common single-display and uniform-DPI cases exactly,
   * and no longer guesses blindly for the rest.
   */
  private async calibrateScaleMode(r: RobotJs): Promise<'none' | 'perDisplayScale'> {
    if (this.scaleMode) return this.scaleMode
    if (process.platform !== 'win32') {
      this.scaleMode = 'none'
      return this.scaleMode
    }
    try {
      const robotPos = r.getMousePos()
      const electronPos = screen.getCursorScreenPoint()
      const matches = Math.abs(robotPos.x - electronPos.x) <= 1 && Math.abs(robotPos.y - electronPos.y) <= 1
      this.scaleMode = matches ? 'none' : 'perDisplayScale'
    } catch {
      this.scaleMode = 'perDisplayScale'
    }
    return this.scaleMode
  }

  private toPhysical(x: number, y: number, mode: 'none' | 'perDisplayScale'): { x: number; y: number } {
    if (mode === 'none') return { x: Math.round(x), y: Math.round(y) }
    const display = screen.getDisplayNearestPoint({ x, y })
    const f = display.scaleFactor || 1
    return { x: Math.round(x * f), y: Math.round(y * f) }
  }

  private toLogical(x: number, y: number, mode: 'none' | 'perDisplayScale'): { x: number; y: number } {
    if (mode === 'none') return { x, y }
    const display = screen.getDisplayNearestPoint({ x, y })
    const f = display.scaleFactor || 1
    return { x: Math.round(x / f), y: Math.round(y / f) }
  }

  async getMousePos(): Promise<{ x: number; y: number }> {
    const r = await this.load()
    const mode = await this.calibrateScaleMode(r)
    const p = r.getMousePos()
    return this.toLogical(p.x, p.y, mode)
  }

  async moveMouse(x: number, y: number, smooth = true): Promise<void> {
    const r = await this.load()
    const mode = await this.calibrateScaleMode(r)
    const p = this.toPhysical(x, y, mode)
    if (smooth) r.moveMouseSmooth(p.x, p.y, 3)
    else r.moveMouse(p.x, p.y)
    await sleep(40)
  }

  async click(x: number | undefined, y: number | undefined, button: MouseButton, double: boolean): Promise<void> {
    const r = await this.load()
    if (x !== undefined && y !== undefined) await this.moveMouse(x, y, true)
    r.mouseClick(button, double)
    await sleep(60)
  }

  async mouseDown(button: MouseButton): Promise<void> {
    const r = await this.load()
    r.mouseToggle('down', button)
  }

  async mouseUp(button: MouseButton): Promise<void> {
    const r = await this.load()
    r.mouseToggle('up', button)
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }, button: MouseButton): Promise<void> {
    const r = await this.load()
    await this.moveMouse(from.x, from.y, false)
    r.mouseToggle('down', button)
    await sleep(80)
    const mode = await this.calibrateScaleMode(r)
    const p = this.toPhysical(to.x, to.y, mode)
    r.dragMouse(p.x, p.y)
    await sleep(80)
    r.mouseToggle('up', button)
    await sleep(60)
  }

  async scroll(dx: number, dy: number): Promise<void> {
    const r = await this.load()
    // robotjs: positive y scrolls up; the tool's dy is "lines down".
    r.scrollMouse(Math.round(dx), Math.round(-dy))
    await sleep(60)
  }

  async typeText(text: string): Promise<void> {
    const r = await this.load()
    const ascii = /^[\x20-\x7e\n\t]*$/.test(text)
    if (ascii) {
      for (const [i, line] of text.split('\n').entries()) {
        if (i > 0) r.keyTap('enter')
        if (line) r.typeString(line)
      }
      await sleep(30)
      return
    }
    // Non-ASCII (e.g. Cyrillic): paste via the clipboard, then restore the previous clipboard content.
    const previous = await clipboard.readText().catch(() => '')
    await clipboard.writeText(text)
    await sleep(40)
    r.keyTap('v', primaryModifier())
    await sleep(120)
    if (previous) await clipboard.writeText(previous).catch(() => undefined)
  }

  async pressKeys(keys: string[]): Promise<void> {
    const r = await this.load()
    const { modifiers, key } = parseCombo(keys)
    const mods = modifiers.map((m) => KEY_MAP[m] ?? m)
    const k = KEY_MAP[key] ?? key
    if (mods.length) r.keyTap(k, mods)
    else r.keyTap(k)
    await sleep(50)
  }

  async focusWindow(target: { id?: number; title?: string; app?: string; pid?: number }): Promise<boolean> {
    return focusWindowNative(target, listWindows)
  }

  async minimizeWindow(target: { id?: number; title?: string; app?: string; pid?: number }): Promise<boolean> {
    const ok = await this.focusWindow(target)
    if (!ok) return false
    if (process.platform === 'darwin') await this.pressKeys(['command', 'm'])
    else if (process.platform === 'win32') await this.pressKeys(['command', 'down'])
    else await this.pressKeys(['alt', 'f9'])
    return true
  }
}
