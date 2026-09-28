import { clipboard, Notification, screen } from 'electron'
import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { captureScreen, hashBuffer, listDisplays, waitForStableFrame } from './screen'
import { listInstalledApps, openTarget } from './apps'
import { lockScreen, setVolume, shutdownSystem, sleepSystem, systemInfo } from './system'
import { rememberEntry } from './memory'
import { createSkill, deleteSkill, listSkills, setSkillEnabled, updateSkill } from './skills'
import { listScenarios, runScenario } from './scenarios'
import { listRoutines } from './routines'
import {
  browserClick,
  browserClose,
  browserFind,
  browserOpen,
  browserRead,
  browserType,
} from './browser'
import { listWindows } from './windows-list'
import type { InputDriver } from './input-driver'
import { error, text, image, truncate } from './util'

export interface ViviToolDeps {
  memoryFile: () => string
  skillsFile: () => string
  scenariosFile: () => string
  routinesFile: () => string
  browserProfileDir: () => string
  speak: (text: string) => Promise<void>
  stopSpeaking: () => Promise<void>
  inputDriver: () => Promise<InputDriver | null>
  /**
   * Called before every mouse/keyboard/window-focus action; throws to abort (fail-safe corner,
   * kill switch, macOS TCC permission gate — CU-06). `kind` says which permission category
   * applies: 'pointer' for mouse/keyboard, 'window' for focus/minimize.
   */
  beforeInputAction?: (kind: 'pointer' | 'window') => Promise<void>
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
  /**
   * CU-03: waits for the screen to stop changing (bounded by maxWaitMs) and captures it, so
   * mouse/keyboard actions with `observe: true` can hand back the settled result inline instead of
   * the caller needing a separate `screenshot` call right after.
   */
  const captureObservation = async (maxWaitMs?: number): Promise<CallToolResult['content']> => {
    const shot = await waitForStableFrame(
      async () => {
        const s = await deps.withOwnWindowsHidden(() =>
          captureScreen({
            quality: deps.screenshotFormat(),
            jpegQuality: deps.screenshotQuality(),
          }),
        )
        return { ...s, hash: hashBuffer(Buffer.from(s.base64, 'base64')) }
      },
      maxWaitMs !== undefined ? { maxWaitMs } : {},
    )
    const caption = `Screen after the action: image ${shot.width}x${shot.height}px covering logical ${shot.logicalWidth}x${shot.logicalHeight} at origin (${shot.displayBounds.x}, ${shot.displayBounds.y}), scale ${shot.scale.toFixed(4)}.`
    return [
      { type: 'image', data: shot.base64, mimeType: shot.mimeType },
      { type: 'text', text: caption },
    ]
  }

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
    'Control the mouse in logical screen coordinates (see screenshot). Actions: move, click, double_click, right_click, middle_click, down, up, drag (from x,y to x2,y2), scroll (dx,dy in lines; positive dy scrolls down, positive dx scrolls right), position. down/up/drag default to the left button; pass button to use right/middle instead (e.g. to drag with the middle button, or release a button other than the one pressed for a manual drag). Set observe:true to get a screenshot of the settled result back inline instead of calling screenshot separately afterward.',
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
      button: z
        .enum(['left', 'right', 'middle'])
        .optional()
        .describe('Button for down/up/drag (default left)'),
      observe: z
        .boolean()
        .optional()
        .describe('Wait for the screen to settle and return a screenshot of the result'),
      waitMs: z
        .number()
        .int()
        .min(0)
        .max(10_000)
        .optional()
        .describe('Max wait for observe, ms (default 1500)'),
    },
    async ({ action, x, y, x2, y2, dx, dy, button, observe, waitMs }) => {
      const driver = await deps.inputDriver()
      if (!driver)
        return error(
          'mouse control is not available on this system (no input driver). On Linux Wayland use X11 or install xdotool/ydotool.',
        )
      try {
        await deps.beforeInputAction?.('pointer')
        let message: string
        switch (action) {
          case 'position': {
            const p = await driver.getMousePos()
            message = `cursor at (${p.x}, ${p.y})`
            break
          }
          case 'move':
            if (x === undefined || y === undefined) return error('x and y are required')
            await driver.moveMouse(x, y, true)
            message = `moved to (${x}, ${y})`
            break
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
            message = `${action} at ${x !== undefined && y !== undefined ? `(${x}, ${y})` : 'current position'}`
            break
          case 'down':
            await driver.mouseDown(button ?? 'left')
            message = `${button ?? 'left'} mouse button down`
            break
          case 'up':
            await driver.mouseUp(button ?? 'left')
            message = `${button ?? 'left'} mouse button up`
            break
          case 'drag':
            if (x === undefined || y === undefined || x2 === undefined || y2 === undefined)
              return error('x, y, x2, y2 are required for drag')
            await driver.drag({ x, y }, { x: x2, y: y2 }, button ?? 'left')
            message = `dragged from (${x}, ${y}) to (${x2}, ${y2})`
            break
          case 'scroll':
            if (x !== undefined && y !== undefined) await driver.moveMouse(x, y, false)
            await driver.scroll(dx ?? 0, dy ?? 0)
            message = `scrolled dx=${dx ?? 0} dy=${dy ?? 0}`
            break
          default:
            return error('unknown action')
        }
        if (!observe) return text(message)
        return { content: [{ type: 'text', text: message }, ...(await captureObservation(waitMs))] }
      } catch (err) {
        return error(`mouse ${action} failed: ${(err as Error).message}`)
      }
    },
    { annotations: { destructiveHint: true } },
  )

  const keyboard = tool(
    'keyboard',
    `Type text or press keys in the focused window. action=type sends literal text (any language; non-ASCII goes through the clipboard). action=press sends a key combination once, e.g. "enter", "ctrl+s", "cmd+space", "alt+tab". action=hotkey is an alias of press. Set observe:true to get a screenshot of the settled result back inline instead of calling screenshot separately afterward. ${KEY_HELP}`,
    {
      action: z.enum(['type', 'press', 'hotkey']),
      text: z.string().optional().describe('Text to type (for action=type)'),
      keys: z
        .string()
        .optional()
        .describe('Key combo like "ctrl+shift+t" (for action=press/hotkey)'),
      pressEnter: z.boolean().optional().describe('After typing, press Enter'),
      observe: z
        .boolean()
        .optional()
        .describe('Wait for the screen to settle and return a screenshot of the result'),
      waitMs: z
        .number()
        .int()
        .min(0)
        .max(10_000)
        .optional()
        .describe('Max wait for observe, ms (default 1500)'),
    },
    async ({ action, text: t, keys, pressEnter, observe, waitMs }) => {
      const driver = await deps.inputDriver()
      if (!driver)
        return error('keyboard control is not available on this system (no input driver).')
      try {
        await deps.beforeInputAction?.('pointer')
        let message: string
        if (action === 'type') {
          if (!t) return error('text is required')
          await driver.typeText(t)
          if (pressEnter) await driver.pressKeys(['enter'])
          message = `typed ${t.length} chars${pressEnter ? ' + Enter' : ''}`
        } else {
          if (!keys) return error('keys is required')
          const combo = keys
            .toLowerCase()
            .split('+')
            .map((k) => k.trim())
            .filter(Boolean)
          await driver.pressKeys(combo)
          message = `pressed ${combo.join('+')}`
        }
        if (!observe) return text(message)
        return { content: [{ type: 'text', text: message }, ...(await captureObservation(waitMs))] }
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
        await deps.beforeInputAction?.('window')
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
    'Store a durable fact or preference about the user in memory so future conversations know it. Not for secrets or temporary task state.',
    {
      fact: z.string().min(3).max(500),
      type: z
        .enum(['profile', 'preference', 'fact', 'project'])
        .default('fact')
        .describe(
          'profile: who they are (name, role); preference: how they like things done; fact: a durable fact worth keeping; project: context about an ongoing project',
        ),
    },
    async ({ fact, type }) => {
      try {
        return text(rememberEntry(deps.memoryFile(), type, fact))
      } catch (err) {
        return error((err as Error).message)
      }
    },
  )

  const listSkillsTool = tool(
    'list_skills',
    'List your saved skills (name, description, enabled state, id, source). Check here before creating a new skill, so you update an existing one instead of making a near-duplicate.',
    {},
    async () => {
      try {
        const skills = listSkills(deps.skillsFile())
        if (!skills.length) return text('no skills yet')
        return text(
          skills
            .map(
              (s) =>
                `${s.enabled ? '✓' : '✗'} "${s.name}" (id ${s.id}, ${s.source}${s.enabled ? '' : ', disabled'}) — ${s.description || '(no description)'}`,
            )
            .join('\n'),
        )
      } catch (err) {
        return error((err as Error).message)
      }
    },
    { annotations: { readOnlyHint: true } },
  )

  const manageSkill = tool(
    'manage_skill',
    'Create, update, delete, or enable/disable a skill — a named, reusable block of instructions injected into your own system prompt (under "## Skills") in every future conversation while enabled. Use for repeatable procedures, house style, or a preferred approach to a recurring kind of task — not one-off facts (use remember) and never for secrets. Like remember, this takes effect starting with a new chat, not in this same conversation.',
    {
      action: z.enum(['create', 'update', 'delete', 'set_enabled']),
      id: z.string().optional().describe('Required for update/delete/set_enabled'),
      name: z.string().max(80).optional().describe('Required for create/update'),
      description: z.string().max(300).optional().describe('One-line summary'),
      body: z
        .string()
        .max(8000)
        .optional()
        .describe('The instructions themselves, required for create/update'),
      enabled: z.boolean().optional().describe('Required for set_enabled'),
    },
    async ({ action, id, name, description, body, enabled }) => {
      try {
        switch (action) {
          case 'create': {
            if (!name || !body) return error('name and body are required to create a skill')
            const result = createSkill(deps.skillsFile(), {
              name,
              description: description ?? '',
              body,
              source: 'agent',
            })
            if (result.error) return error(result.error)
            return text(`created skill "${result.skill!.name}" (id ${result.skill!.id})`)
          }
          case 'update': {
            if (!id) return error('id is required to update a skill')
            if (!name || !body) return error('name and body are required to update a skill')
            const result = updateSkill(deps.skillsFile(), id, {
              name,
              description: description ?? '',
              body,
            })
            if (result.error) return error(result.error)
            return text(`updated skill "${result.skill!.name}"`)
          }
          case 'delete': {
            if (!id) return error('id is required to delete a skill')
            deleteSkill(deps.skillsFile(), id)
            return text('deleted')
          }
          case 'set_enabled': {
            if (!id || enabled === undefined)
              return error('id and enabled are required for set_enabled')
            setSkillEnabled(deps.skillsFile(), id, enabled)
            return text(`${enabled ? 'enabled' : 'disabled'} skill ${id}`)
          }
        }
      } catch (err) {
        return error((err as Error).message)
      }
    },
  )

  const listScenariosTool = tool(
    'list_scenarios',
    'List ready-made scenarios (name, description, example trigger phrases, enabled state) that run_scenario can execute. A scenario is a fixed, user-assembled sequence of steps (e.g. "open Spotify, then press play") — check here for one matching the user\'s request before doing the steps yourself.',
    {},
    async () => {
      try {
        const scenarios = listScenarios(deps.scenariosFile())
        if (!scenarios.length) return text('no scenarios yet')
        return text(
          scenarios
            .map(
              (s) =>
                `${s.enabled ? '✓' : '✗'} "${s.name}"${s.enabled ? '' : ' (disabled)'} — ${s.description || `${s.steps.length} step(s)`}${s.triggerPhrases.length ? ` [e.g. ${s.triggerPhrases.map((p) => `"${p}"`).join(', ')}]` : ''}`,
            )
            .join('\n'),
        )
      } catch (err) {
        return error((err as Error).message)
      }
    },
    { annotations: { readOnlyHint: true } },
  )

  const runScenarioTool = tool(
    'run_scenario',
    'Run a ready-made scenario by name or id — a fixed sequence of steps (open an app, wait, press keys, type text, notify) that runs directly instead of you reasoning through each step. Use list_scenarios first to find the right one. Scenarios can only be created/edited by the user in the Workshop screen, never by you.',
    { name: z.string().min(1).describe('Scenario name or id, from list_scenarios') },
    async ({ name }) => {
      try {
        await deps.beforeInputAction?.('pointer')
        const result = await runScenario(deps.scenariosFile(), name, {
          inputDriver: deps.inputDriver,
        })
        if (result.error)
          return error(
            result.log?.length
              ? `${result.error} (completed so far: ${result.log.join('; ')})`
              : result.error,
          )
        return text(`ran scenario "${result.ran}": ${result.log?.join('; ') || 'done'}`)
      } catch (err) {
        return error((err as Error).message)
      }
    },
    { annotations: { destructiveHint: true } },
  )

  const listRoutinesTool = tool(
    'list_routines',
    'List routines: prompts the user has scheduled to run unattended (daily, on an interval, or once), with their schedule and next run time. Read-only — routines are created/edited by the user in the Workshop screen, never by you, and there is no tool to run one on demand (the user can do that from the Workshop screen).',
    {},
    async () => {
      try {
        const routines = listRoutines(deps.routinesFile())
        if (!routines.length) return text('no routines yet')
        return text(
          routines
            .map((r) => {
              const status = r.enabled
                ? r.nextRunAt
                  ? `next run ${new Date(r.nextRunAt).toISOString()}`
                  : 'enabled'
                : 'disabled'
              return `"${r.name}" (${status}): ${r.prompt.slice(0, 120)}`
            })
            .join('\n'),
        )
      } catch (err) {
        return error((err as Error).message)
      }
    },
    { annotations: { readOnlyHint: true } },
  )

  const browserOpenTool = tool(
    'browser_open',
    "Open a URL in Vivi's own dedicated automation browser (not the user's everyday browser — a separate, isolated profile) and return the page title and a short text preview. Prefer this plus browser_find/browser_click/browser_type/browser_read over driving a page with screenshot+mouse: faster, more reliable, and works even if the window isn't visible on screen.",
    { url: z.string().min(1).describe('URL to open, e.g. https://example.com') },
    async ({ url }) => {
      try {
        const r = await browserOpen(deps.browserProfileDir(), url)
        return text(`opened ${r.url}\ntitle: ${r.title}\n${r.text}`)
      } catch (err) {
        return error(`browser_open failed: ${(err as Error).message}`)
      }
    },
  )

  const browserFindTool = tool(
    'browser_find',
    "Find elements on the currently open automation-browser page, by CSS selector or by visible text (give exactly one). Returns each match's ref (use it with browser_click/browser_type), tag, trimmed text and a few useful attributes. Call this before browser_click/browser_type — refs are not guessable.",
    {
      selector: z.string().optional().describe('CSS selector, e.g. "button.submit"'),
      text: z.string().optional().describe('Visible text to search for instead of a selector'),
    },
    async ({ selector, text: query }) => {
      if (!selector && !query) return error('give either selector or text')
      try {
        const els = await browserFind(deps.browserProfileDir(), { selector, text: query })
        if (!els.length) return text('no matching elements found')
        return text(
          els
            .map(
              (e) =>
                `${e.ref} <${e.tag}> "${e.text}" ${Object.entries(e.attributes)
                  .map(([k, v]) => `${k}="${v}"`)
                  .join(' ')}`,
            )
            .join('\n'),
        )
      } catch (err) {
        return error(`browser_find failed: ${(err as Error).message}`)
      }
    },
    { annotations: { readOnlyHint: true } },
  )

  const browserClickTool = tool(
    'browser_click',
    'Click an element on the automation-browser page by its ref (from browser_find).',
    { ref: z.string().min(1) },
    async ({ ref }) => {
      try {
        return text(await browserClick(deps.browserProfileDir(), ref))
      } catch (err) {
        return error(`browser_click failed: ${(err as Error).message}`)
      }
    },
    { annotations: { destructiveHint: true } },
  )

  const browserTypeTool = tool(
    'browser_type',
    "Type text into an input, textarea or editable element on the automation-browser page, by its ref (from browser_find). Replaces the field's current content.",
    { ref: z.string().min(1), text: z.string() },
    async ({ ref, text: value }) => {
      try {
        return text(await browserType(deps.browserProfileDir(), ref, value))
      } catch (err) {
        return error(`browser_type failed: ${(err as Error).message}`)
      }
    },
    { annotations: { destructiveHint: true } },
  )

  const browserReadTool = tool(
    'browser_read',
    "Read the automation-browser page's visible text (optionally scoped to a CSS selector), for when you need the full content rather than the short preview from browser_open.",
    { selector: z.string().optional().describe('Limit to this element instead of the whole page') },
    async ({ selector }) => {
      try {
        return text(await browserRead(deps.browserProfileDir(), selector))
      } catch (err) {
        return error(`browser_read failed: ${(err as Error).message}`)
      }
    },
    { annotations: { readOnlyHint: true } },
  )

  const browserCloseTool = tool(
    'browser_close',
    "Close Vivi's automation browser. Use when you're done with it, or to recover from a page that got stuck.",
    {},
    async () => {
      try {
        await browserClose()
        return text('closed')
      } catch (err) {
        return error(`browser_close failed: ${(err as Error).message}`)
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
      listSkillsTool,
      manageSkill,
      listScenariosTool,
      runScenarioTool,
      listRoutinesTool,
      browserOpenTool,
      browserFindTool,
      browserClickTool,
      browserTypeTool,
      browserReadTool,
      browserCloseTool,
    ],
  })
}
