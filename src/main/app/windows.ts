import { join } from 'node:path'
import { BrowserWindow, app, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { emit } from '../ipc/emitters'
import { logger } from '../logging/log'
import { paths } from '../util/paths'
import { attachEditContextMenu } from './menu'
import { clampToDisplays, loadWindowState, saveWindowState } from './window-state'
import icon from '../../../resources/icon.png?asset'

/**
 * UX-05: without this, Electron's default `webPreferences.devTools` (true) leaves DevTools
 * reachable in a shipped build via any route — the default app menu's "Toggle Developer Tools",
 * its keyboard shortcut, or a stray `webContents.openDevTools()` call — with nothing gating it.
 * Applied to every window Vivi creates, not just the main one.
 */
const devToolsEnabled = is.dev

const log = logger('windows')

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let hudWindow: BrowserWindow | null = null
let hudHideTimer: ReturnType<typeof setTimeout> | null = null
let launcherWindow: BrowserWindow | null = null
let launcherDisplayWatcherStarted = false
let quitting = false

export function markQuitting(): void {
  quitting = true
}

const preloadPath = join(import.meta.dirname, '../preload/index.mjs')

function loadRenderer(
  win: BrowserWindow,
  file: 'index.html' | 'overlay.html',
  hash?: string,
): void {
  const suffix = hash ? `#${hash}` : ''
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${file}${suffix}`)
  } else {
    void win.loadFile(join(import.meta.dirname, `../renderer/${file}`), hash ? { hash } : undefined)
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null
}

/**
 * CU-05: a screenshot the agent takes to see the user's screen is a full-display capture — it has
 * no way to selectively omit one window's already-composited pixels — so without this, Vivi's own
 * chat window or overlay orb (if visible) would show up inside its own "here's what I see"
 * screenshot, confusing the model and potentially leaking chat content back into itself. Toggles
 * OS-level content protection on Vivi's own windows only for the duration of `fn`, so a
 * screen-share the user is running in another app still sees Vivi normally the rest of the time.
 */
export async function withOwnWindowsHidden<T>(fn: () => Promise<T>): Promise<T> {
  const windows = [getMainWindow(), getOverlayWindow(), getHudWindow(), getLauncherWindow()].filter(
    (w): w is BrowserWindow => w !== null,
  )
  for (const w of windows) w.setContentProtection(true)
  try {
    return await fn()
  } finally {
    for (const w of windows) if (!w.isDestroyed()) w.setContentProtection(false)
  }
}

const DEFAULT_WIDTH = 1180
const DEFAULT_HEIGHT = 780
const MIN_WIDTH = 880
const MIN_HEIGHT = 560
const SAVE_BOUNDS_DEBOUNCE_MS = 500

/**
 * UX-08: the un-maximized bounds are the only ones meaningful as a "restore to" size — while
 * maximized, `getBounds()` reports the full-screen rect, which would otherwise clobber the real
 * saved size the next time the user un-maximizes.
 */
function restorableBounds(win: BrowserWindow): {
  x: number
  y: number
  width: number
  height: number
} {
  return win.isMaximized() ? win.getNormalBounds() : win.getBounds()
}

export function createMainWindow(opts: { startHidden: boolean }): BrowserWindow {
  const existing = getMainWindow()
  if (existing) return existing

  // UX-08: restores the window to wherever the user last left it instead of always reopening at a
  // fixed size in the middle of the primary display. Falls back to the hardcoded default if
  // nothing was saved yet or the file is unreadable/corrupt; clamped in case a monitor the window
  // was saved on has since been disconnected.
  const saved = loadWindowState(paths.windowStateFile)
  const { x, y, width, height } = saved
    ? clampToDisplays(
        saved,
        screen.getAllDisplays().map((d) => d.bounds),
        MIN_WIDTH,
        MIN_HEIGHT,
      )
    : { x: undefined, y: undefined, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d14',
    title: 'Vivi',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'darwin'
        ? undefined
        : { color: '#0b0d14', symbolColor: '#c7cbe0', height: 40 },
    trafficLightPosition: { x: 14, y: 14 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: devToolsEnabled,
    },
  })
  mainWindow = win
  if (saved?.isMaximized) win.maximize()

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleSaveBounds = (): void => {
    if (win.isMinimized()) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveWindowState(paths.windowStateFile, {
        ...restorableBounds(win),
        isMaximized: win.isMaximized(),
      })
    }, SAVE_BOUNDS_DEBOUNCE_MS)
  }

  win.on('ready-to-show', () => {
    if (!opts.startHidden) win.show()
  })
  win.on('resize', scheduleSaveBounds)
  win.on('move', scheduleSaveBounds)
  win.on('close', (e) => {
    if (saveTimer) clearTimeout(saveTimer)
    saveMainWindowState()
    // Vivi lives in the tray: closing the window hides it unless the app is quitting.
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })
  attachEditContextMenu(win)
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('main renderer gone', details)
    if (details.reason !== 'clean-exit') win.webContents.reload()
  })

  loadRenderer(win, 'index.html')
  return win
}

/**
 * Persists the current main-window bounds immediately. Exposed for the app-quit path
 * (`BrowserWindow.destroy()`, used when force-closing all windows, skips the 'close' event
 * entirely) so the last known position/size is still saved even when the window is torn down
 * without a normal close.
 */
export function saveMainWindowState(): void {
  const win = getMainWindow()
  if (!win) return
  saveWindowState(paths.windowStateFile, {
    ...restorableBounds(win),
    isMaximized: win.isMaximized(),
  })
}

export function showMainWindow(): void {
  const win = getMainWindow() ?? createMainWindow({ startHidden: false })
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function createOverlayWindow(): BrowserWindow {
  const existing = getOverlayWindow()
  if (existing) return existing

  const win = new BrowserWindow({
    width: 760,
    height: 460,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    title: 'Vivi Overlay',
    ...(process.platform === 'darwin'
      ? { type: 'panel' as const, hiddenInMissionControl: true }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: devToolsEnabled,
    },
  })
  overlayWindow = win
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')
  // overlay.html's own <title> tag would otherwise clobber this via page-title-updated — every
  // window sharing that file (overlay, HUD, launcher) needs its constructor title to stick so
  // they stay distinguishable by title (see e.g. the "overlay window exists" e2e check).
  win.on('page-title-updated', (e) => e.preventDefault())
  win.on('blur', () => {
    if (win.isVisible() && !win.webContents.isDevToolsOpened()) hideOverlay()
  })
  win.on('closed', () => {
    overlayWindow = null
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('overlay renderer gone', details)
    if (details.reason !== 'clean-exit') win.webContents.reload()
  })
  loadRenderer(win, 'overlay.html')
  return win
}

export function getHudWindow(): BrowserWindow | null {
  return hudWindow && !hudWindow.isDestroyed() ? hudWindow : null
}

const HUD_WIDTH = 460
const HUD_HEIGHT = 56
const HUD_AUTO_HIDE_MS = 2_500

/**
 * CU-07: a small, click-through, always-on-top bar so the user always knows Vivi is currently
 * moving the mouse or typing — even while focused on a different app — and how to stop it.
 */
function createHudWindow(): BrowserWindow {
  const existing = getHudWindow()
  if (existing) return existing

  const win = new BrowserWindow({
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    title: 'Vivi Control HUD',
    ...(process.platform === 'darwin'
      ? { type: 'panel' as const, hiddenInMissionControl: true }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: devToolsEnabled,
    },
  })
  hudWindow = win
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.on('page-title-updated', (e) => e.preventDefault())
  win.on('closed', () => {
    hudWindow = null
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('control HUD renderer gone', details)
    if (details.reason !== 'clean-exit') win.webContents.reload()
  })
  loadRenderer(win, 'overlay.html', 'hud')
  return win
}

/** Shows (or keeps showing) the "Vivi is controlling your computer" HUD, auto-hiding after a period of no further input actions. */
export function pingControlHud(): void {
  const win = getHudWindow() ?? createHudWindow()
  if (!win.isVisible()) {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const { x, y, width } = display.workArea
    win.setPosition(Math.round(x + (width - HUD_WIDTH) / 2), Math.round(y + 24))
    win.showInactive()
  }
  if (hudHideTimer) clearTimeout(hudHideTimer)
  hudHideTimer = setTimeout(() => win.hide(), HUD_AUTO_HIDE_MS)
}

/** Hides the control HUD immediately (e.g. on kill switch). */
export function hideControlHud(): void {
  if (hudHideTimer) {
    clearTimeout(hudHideTimer)
    hudHideTimer = null
  }
  getHudWindow()?.hide()
}

const LAUNCHER_SIZE = 56
const LAUNCHER_MARGIN = 12

/**
 * WORK-04: bottom-left corner of the primary display's work area — next to where a taskbar's
 * Start button normally sits. This is the closest a third-party Electron app can get to a
 * Cortana-style taskbar button: Windows has no API to embed into the real taskbar, so a small
 * always-on-top floating window pinned to that corner is the honest approximation.
 */
function launcherPosition(): { x: number; y: number } {
  const { x, y, height } = screen.getPrimaryDisplay().workArea
  return { x: x + LAUNCHER_MARGIN, y: y + height - LAUNCHER_SIZE - LAUNCHER_MARGIN }
}

export function getLauncherWindow(): BrowserWindow | null {
  return launcherWindow && !launcherWindow.isDestroyed() ? launcherWindow : null
}

function createLauncherWindow(): BrowserWindow {
  const existing = getLauncherWindow()
  if (existing) return existing

  const { x, y } = launcherPosition()
  const win = new BrowserWindow({
    x,
    y,
    width: LAUNCHER_SIZE,
    height: LAUNCHER_SIZE,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    title: 'Vivi Quick Access',
    ...(process.platform === 'darwin'
      ? { type: 'panel' as const, hiddenInMissionControl: true }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: devToolsEnabled,
    },
  })
  launcherWindow = win
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.on('page-title-updated', (e) => e.preventDefault())
  win.on('closed', () => {
    launcherWindow = null
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('launcher renderer gone', details)
    if (details.reason !== 'clean-exit') win.webContents.reload()
  })
  loadRenderer(win, 'overlay.html', 'launcher')
  return win
}

export function showLauncherButton(): void {
  const win = getLauncherWindow() ?? createLauncherWindow()
  const { x, y } = launcherPosition()
  win.setPosition(x, y)
  win.showInactive()
}

export function hideLauncherButton(): void {
  getLauncherWindow()?.hide()
}

/** Keeps the launcher pinned to its corner if a display is connected/disconnected/rearranged while it's showing. Idempotent — safe to call on every startup. */
export function watchLauncherDisplays(): void {
  if (launcherDisplayWatcherStarted) return
  launcherDisplayWatcherStarted = true
  const reposition = (): void => {
    const win = getLauncherWindow()
    if (!win || !win.isVisible()) return
    const { x, y } = launcherPosition()
    win.setPosition(x, y)
  }
  screen.on('display-added', reposition)
  screen.on('display-removed', reposition)
  screen.on('display-metrics-changed', reposition)
}

export function showOverlay(): void {
  const win = getOverlayWindow() ?? createOverlayWindow()
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width } = display.workArea
  const [w] = win.getSize()
  win.setPosition(Math.round(x + (width - (w ?? 760)) / 2), Math.round(y + 80))
  win.show()
  win.focus()
  emit('overlay:visibility', true)
}

export function hideOverlay(): void {
  const win = getOverlayWindow()
  if (win && win.isVisible()) {
    win.hide()
    emit('overlay:visibility', false)
  }
}

export function toggleOverlay(): void {
  const win = getOverlayWindow()
  if (win && win.isVisible()) hideOverlay()
  else showOverlay()
}

export function isOverlayVisible(): boolean {
  return getOverlayWindow()?.isVisible() ?? false
}

export function destroyAllWindows(): void {
  markQuitting()
  // destroy() skips the 'close' event entirely, so the debounced/close-triggered saves never run.
  saveMainWindowState()
  for (const w of BrowserWindow.getAllWindows()) w.destroy()
}

export function appIconPath(): string {
  return app.isPackaged ? icon : icon
}
