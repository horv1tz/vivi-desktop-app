import { clipboard, Notification, screen } from 'electron'
import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import { captureScreen, listDisplays } from './screen'
import { listInstalledApps, openTarget } from './apps'
import { lockScreen, setVolume, shutdownSystem, sleepSystem, systemInfo } from './system'
import { rememberFact } from './memory'
import { listWindows } from './windows-list'
import type { InputDriver } from './input-driver'
import { error, text, image, truncate } from './util'

export interface ViviToolDeps {
  memoryFile: () => string
  speak: (text: string) => Promise<void>
  stopSpeaking: () => Promise<void>
  inputDriver: () => Promise<InputDriver | null>
  /** Called before every mouse/keyboard action; throws to abort (fail-safe corner, kill switch). */
  beforeInputAction?: () => Promise<void>
  appRegistryEnabled: () => boolean
  /** CU-05: hides Vivi's own windows from screen capture for the duration of the callback. */
  withOwnWindowsHidden: <T>(fn: () => Promise<T>) => Promise<T>
  /** AG-10: screenshot encoding; jpeg trades some fidelity (small text can blur) for far fewer tokens/latency. */
  screenshotFormat: () => 'png' | 'jpeg'
  screenshotQuality: () => number
  log: {
    info: (...a: unknown[]) => void
    warn: (...a: unknown[]) => void
    error: (...a: unknown[]) => void
  }
}

const KEY_HELP =
  'Key names: letters/digits, enter, tab, escape, backspace, delete, space, up/down/left/right, home, end, pageup, pagedown, f1-f12, and modifiers ctrl, alt, shift, cmd/command/win/super. Combine with "+", e.g. "ctrl+c", "cmd+shift+4", "alt+tab".'

export function createViviMcpServer(deps: ViviToolDeps): McpSdkServerConfigWithInstance {
  const screenshot = tool(
    'screenshot',
    'Capture the screen so you can see it. Returns a downscaled image (PNG or JPEG, per settings) plus its pixel size and the logical size of the display; the mouse/keyboard tools use logical coordinates of that display. Optional: display index (0 = primary) or a region {x,y,width,height} in logical coordinates.',
    {
      display: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'Display index from system_info/screenshot output; defaults to the display under the cursor',
        ),
      region: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .optional()
        .describe('Crop to this logical-coordinate region of the display'),
    },
    async ({ display, region }) => {
      try {
        const shot = await deps.withOwnWindowsHidden(() =>
          captureScreen({
            display,
            region,
            quality: deps.screenshotFormat(),
            jpegQuality: deps.screenshotQuality(),
          }),
        )
        const caption = `Screenshot of display #${shot.displayIndex} (id ${shot.displayId}): image ${shot.width}x${shot.height}px covering logical ${shot.logicalWidth}x${shot.logicalHeight} at origin (${shot.displayBounds.x + (region?.x ?? 0)}, ${shot.displayBounds.y + (region?.y ?? 0)}). To click a point seen at image pixel (px, py) use x = ${shot.displayBounds.x + (region?.x ?? 0)} + px * ${shot.scale.toFixed(4)}, y = ${shot.displayBounds.y + (region?.y ?? 0)} + py * ${shot.scale.toFixed(4)}. Cursor at (${screen.getCursorScreenPoint().x}, ${screen.getCursorScreenPoint().y}).`
        return image(shot.base64, shot.mimeType, caption)
      } catch (err) {
        return error(`screenshot failed: ${(err as Error).message}`)
      }
    },
    { annotations: { readOnlyHint: true } },
  )

  const mouse = tool(
    'mouse',
    'Control the mouse in logical screen coordinates (see screenshot). Actions: move, click, double_click, right_click, middle_click, down, up, drag (from x,y to x2,y2), scroll (dx,dy in lines; positive dy scrolls down), position.',
    {
      action: z.enum([
        'move',
        'click',
        'double_click',
        'right_click',
        'middle_click',
        'down',
        'up',
        'drag',
        'scroll',
        'position',
      ]),
      x: z.number().optional(),
      y: z.number().optional(),
      x2: z.number().optional().describe('drag end x'),
      y2: z.number().optional().describe('drag end y'),
      dx: z.number().optional().describe('scroll horizontal amount'),
      dy: z.number().optional().describe('scroll vertical amount'),
    },
    async ({ action, x, y, x2, y2, dx, dy }) => {
      const driver = await deps.inputDriver()
      if (!driver)
        return error(
          'mouse control is not available on this system (no input driver). On Linux Wayland use X11 or install xdotool/ydotool.',
        )
      try {
        await deps.beforeInputAction?.()
        switch (action) {
          case 'position': {
            const p = await driver.getMousePos()
            return text(`cursor at (${p.x}, ${p.y})`)
          }
          case 'move':
            if (x === undefined || y === undefined) return error('x and y are required')
            await driver.moveMouse(x, y, true)
            return text(`moved to (${x}, ${y})`)
          case 'click':
          case 'double_click':
          case 'right_click':
          case 'middle_click':
            await driver.click(
              x,
              y,
              action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : 'left',
              action === 'double_click',
            )
            return text(
              `${action} at ${x !== undefined && y !== undefined ? `(${x}, ${y})` : 'current position'}`,
            )
          case 'down':
            await driver.mouseDown('left')
            return text('mouse button down')
          case 'up':
            await driver.mouseUp('left')
            return text('mouse button up')
          case 'drag':
            if (x === undefined || y === undefined || x2 === undefined || y2 === undefined)
              return error('x, y, x2, y2 are required for drag')
            await driver.drag({ x, y }, { x: x2, y: y2 }, 'left')
            return text(`dragged from (${x}, ${y}) to (${x2}, ${y2})`)
          case 'scroll':
            if (x !== undefined && y !== undefined) await driver.moveMouse(x, y, false)
            await driver.scroll(dx ?? 0, dy ?? 0)
            return text(`scrolled dx=${dx ?? 0} dy=${dy ?? 0}`)
        }
      } catch (err) {
        return error(`mouse ${action} failed: ${(err as Error).message}`)
      }
      return error('unknown action')
    },
    { annotations: { destructiveHint: true } },
  )

  const keyboard = tool(
    'keyboard',
    `Type text or press keys in the focused window. action=type sends literal text (any language; non-ASCII goes through the clipboard). action=press sends a key combination once, e.g. "enter", "ctrl+s", "cmd+space", "alt+tab". action=hotkey is an alias of press. ${KEY_HELP}`,
    {
      action: z.enum(['type', 'press', 'hotkey']),
      text: z.string().optional().describe('Text to type (for action=type)'),
      keys: z
        .string()
        .optional()
        .describe('Key combo like "ctrl+shift+t" (for action=press/hotkey)'),
      pressEnter: z.boolean().optional().describe('After typing, press Enter'),
    },
    async ({ action, text: t, keys, pressEnter }) => {
      const driver = await deps.inputDriver()
      if (!driver)
        return error('keyboard control is not available on this system (no input driver).')
      try {
        await deps.beforeInputAction?.()
        if (action === 'type') {
          if (!t) return error('text is required')
          await driver.typeText(t)
          if (pressEnter) await driver.pressKeys(['enter'])
          return text(`typed ${t.length} chars${pressEnter ? ' + Enter' : ''}`)
        }
        if (!keys) return error('keys is required')
        const combo = keys
          .toLowerCase()
          .split('+')
          .map((k) => k.trim())
          .filter(Boolean)
        await driver.pressKeys(combo)
        return text(`pressed ${combo.join('+')}`)
      } catch (err) {
        return error(`keyboard ${action} failed: ${(err as Error).message}`)
      }
    },
    { annotations: { destructiveHint: true } },
  )

  const listWindowsTool = tool(
    'list_windows',
    'List open application windows with ids, titles, owning app, pid and bounds (logical coordinates). Use before focusing a window.',
    {},
    async () => {
      try {
        const windows = await listWindows()
        if (!windows.length) return text('no windows found')
        return text(
          windows
            .map(
              (w) =>
                `${w.active ? '* ' : '  '}#${w.id} [${w.app}${w.pid ? ` pid ${w.pid}` : ''}] "${w.title}" @ ${w.bounds.x},${w.bounds.y} ${w.bounds.width}x${w.bounds.height}`,
            )
            .join('\n'),
        )
      } catch (err) {
        return error((err as Error).message)
      }
    },
    { annotations: { readOnlyHint: true } },
  )

  const windowsTool = tool(
    'windows',
    'Focus (activate) or minimize a window by id, exact/partial title, app name or pid. Focus the target app before typing into it.',
    {
      action: z.enum(['focus', 'minimize']),
      id: z.number().int().optional(),
      title: z.string().optional(),
      app: z.string().optional(),
      pid: z.number().int().optional(),
    },
    async ({ action, id, title, app, pid }) => {
      const driver = await deps.inputDriver()
      if (!driver) return error('window control is not available on this system.')
      try {
        await deps.beforeInputAction?.()
        const ok =
          action === 'focus'
            ? await driver.focusWindow({ id, title, app, pid })
            : await (driver.minimizeWindow?.({ id, title, app, pid }) ?? Promise.resolve(false))
        return ok ? text(`${action}: ok`) : error(`${action}: window not found`)
      } catch (err) {
        return error(`${action} failed: ${(err as Error).message}`)
      }
    },
  )

  const open = tool(
    'open',
    'Open something for the user: an application by name (e.g. "Safari", "Visual Studio Code", "Telegram"), a file or folder path, or a URL. Prefer this over driving the mouse to launch apps.',
    { target: z.string().min(1).describe('App name, absolute/~ path, or URL') },
    async ({ target }) => {
      try {
        return text(await openTarget(target))
      } catch (err) {
        return error(`open failed: ${(err as Error).message}`)
      }
    },
  )

  const listApps = tool(
    'list_apps',
    'List installed applications (names) to find the exact name for the open tool. Optional filter substring.',
    { filter: z.string().optional() },
    async ({ filter }) => {
      if (!deps.appRegistryEnabled()) return error('app registry is disabled in settings')
      try {
        const apps = await listInstalledApps()
        const f = filter?.toLowerCase()
        const list = (f ? apps.filter((a) => a.name.toLowerCase().includes(f)) : apps).slice(0, 300)
        return text(list.length ? list.map((a) => a.name).join('\n') : 'no apps matched')
      } catch (err) {
        return error((err as Error).message)
      }
    },
    { annotations: { readOnlyHint: true } },
  )

  const clipboardRead = tool(
    'clipboard_read',
    'Read the current text from the system clipboard.',
    {},
    async () => {
      try {
        const t = await clipboard.readText()
        return text(t ? truncate(t, 50_000) : '(clipboard is empty or not text)')
      } catch (err) {
        return error((err as Error).message)
      }
    },
    { annotations: { readOnlyHint: true } },
  )

  const clipboardWrite = tool(
    'clipboard_write',
    'Put text on the system clipboard.',
    { text: z.string() },
    async ({ text: t }) => {
      try {
        await clipboard.writeText(t)
        return text(`copied ${t.length} chars to clipboard`)
      } catch (err) {
        return error((err as Error).message)
      }
    },
  )

  const notify = tool(
    'notify',
    'Show a desktop notification to the user (short title + body). Use for background task completions, not for normal replies.',
    { title: z.string().min(1).max(80), body: z.string().max(400).default('') },
    async ({ title, body }) => {
      if (!Notification.isSupported()) return error('notifications are not supported here')
      new Notification({ title, body }).show()
      return text('notification shown')
    },
  )

  const system = tool(
    'system',
    'System actions. action=info returns OS, hardware, displays and cursor. Others: lock (lock screen), sleep, shutdown, restart, volume (value: 0-100 number or "mute"/"unmute"/"up"/"down"). Destructive actions always ask the user first.',
    {
      action: z.enum(['info', 'lock', 'sleep', 'shutdown', 'restart', 'volume']),
      value: z.union([z.number(), z.enum(['mute', 'unmute', 'up', 'down'])]).optional(),
    },
    async ({ action, value }) => {
      try {
        switch (action) {
          case 'info':
            return text(JSON.stringify({ ...systemInfo(), displays: listDisplays() }, null, 2))
          case 'lock':
            return text(await lockScreen())
          case 'sleep':
            return text(await sleepSystem())
          case 'shutdown':
            return text(await shutdownSystem(false))
          case 'restart':
            return text(await shutdownSystem(true))
          case 'volume':
            if (value === undefined) return error('value is required for volume')
            return text(await setVolume(value))
        }
      } catch (err) {
        return error(`${action} failed: ${(err as Error).message}`)
      }
      return error('unknown action')
    },
  )

  const systemInfoTool = tool(
    'system_info',
    'Return OS, hardware, display layout and cursor position (read-only).',
    {},
    async () => text(JSON.stringify({ ...systemInfo(), displays: listDisplays() }, null, 2)),
    { annotations: { readOnlyHint: true } },
  )

  const speak = tool(
    'speak',
    'Say something out loud through the speakers using text-to-speech. Only for short spoken notes (e.g. announcing a completed background task); normal replies are spoken automatically in voice mode.',
    { text: z.string().min(1).max(2000) },
    async ({ text: t }) => {
      try {
        await deps.speak(t)
        return text('speaking')
      } catch (err) {
        return error(`speak failed: ${(err as Error).message}`)
      }
    },
  )

  const stopSpeaking = tool(
    'stop_speaking',
    'Stop any ongoing text-to-speech playback.',
    {},
    async () => {
      await deps.stopSpeaking()
      return text('stopped')
    },
  )

  const remember = tool(
    'remember',
    'Store a durable fact or preference about the user in the memory file (VIVI.md) so future conversations know it. Not for secrets or temporary task state.',
    {
      fact: z.string().min(3).max(500),
      category: z.string().max(40).optional().describe('e.g. preference, project, contact, habit'),
    },
    async ({ fact, category }) => {
      try {
        return text(rememberFact(deps.memoryFile(), fact, category))
      } catch (err) {
        return error((err as Error).message)
      }
    },
  )

  return createSdkMcpServer({
    name: 'vivi',
    version: '1.0.0',
    tools: [
      screenshot,
      mouse,
      keyboard,
      listWindowsTool,
      windowsTool,
      open,
      listApps,
      clipboardRead,
      clipboardWrite,
      notify,
      system,
      systemInfoTool,
      speak,
      stopSpeaking,
      remember,
    ],
  })
}
