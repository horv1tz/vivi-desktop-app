import { join } from 'node:path'
import { BrowserWindow, app, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { emit } from '../ipc/emitters'
import { logger } from '../logging/log'
import icon from '../../../resources/icon.png?asset'

const log = logger('windows')

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let quitting = false

export function markQuitting(): void {
  quitting = true
}

const preloadPath = join(import.meta.dirname, '../preload/index.mjs')

function loadRenderer(win: BrowserWindow, file: 'index.html' | 'overlay.html'): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${file}`)
  } else {
    void win.loadFile(join(import.meta.dirname, `../renderer/${file}`))
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
  const windows = [getMainWindow(), getOverlayWindow()].filter(
    (w): w is BrowserWindow => w !== null,
  )
  for (const w of windows) w.setContentProtection(true)
  try {
    return await fn()
  } finally {
    for (const w of windows) if (!w.isDestroyed()) w.setContentProtection(false)
  }
}

export function createMainWindow(opts: { startHidden: boolean }): BrowserWindow {
  const existing = getMainWindow()
  if (existing) return existing

  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 560,
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
    },
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    if (!opts.startHidden) win.show()
  })
  win.on('close', (e) => {
    // Vivi lives in the tray: closing the window hides it unless the app is quitting.
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })
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
    },
  })
  overlayWindow = win
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')
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
  for (const w of BrowserWindow.getAllWindows()) w.destroy()
}

export function appIconPath(): string {
  return app.isPackaged ? icon : icon
}
