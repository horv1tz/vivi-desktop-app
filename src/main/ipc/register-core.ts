import { app, dialog, nativeTheme, shell } from 'electron'
import type { AppInfo, OsPermissionStatus } from '@shared/events'
import { settings } from '../settings/store'
import { paths } from '../util/paths'
import { describeClaudeBinary } from '../util/claude-bin'
import { getMainWindow, hideOverlay, showMainWindow, toggleOverlay } from '../app/windows'
import { getOsPermissions, requestOsPermission } from '../app/os-permissions'
import { handle } from './handlers'
import { emit } from './emitters'

export const SDK_VERSION = '0.3.283'

export function registerCoreHandlers(opts: { mockAgent: boolean }): void {
  handle('app:getInfo', (): AppInfo => {
    const s = settings().get()
    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      userDataPath: paths.userData,
      logsPath: paths.logsDir,
      workspaceDir: paths.workspace(s.agent.workspaceDir),
      claudeBinary: describeClaudeBinary(),
      sdkVersion: SDK_VERSION,
      mockAgent: opts.mockAgent,
    }
  })
  handle('app:getOsPermissions', (): OsPermissionStatus => getOsPermissions())
  handle('app:requestOsPermission', (_e, kind) => requestOsPermission(kind))
  handle('app:openLogs', async () => {
    await shell.openPath(paths.logsDir)
  })
  handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  handle('settings:get', () => settings().get())
  handle('settings:update', (_e, patch) => {
    const next = settings().update(patch)
    nativeTheme.themeSource = next.appearance.theme
    emit('settings:changed', next)
    return next
  })
  handle('settings:reset', () => {
    const next = settings().reset()
    emit('settings:changed', next)
    return next
  })
  handle('settings:pickDirectory', async (_e, defaultPath) => {
    const win = getMainWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], defaultPath })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  handle('settings:pickFile', async (_e, defaultPath) => {
    const win = getMainWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'], defaultPath })
      : await dialog.showOpenDialog({ properties: ['openFile'], defaultPath })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  handle('window:showMain', () => showMainWindow())
  handle('window:hideOverlay', () => hideOverlay())
  handle('window:toggleOverlay', () => toggleOverlay())
  handle('window:minimize', () => getMainWindow()?.minimize())
  handle('window:maximize', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  handle('window:close', () => getMainWindow()?.close())

  handle('shell:openExternal', async (_e, url) => {
    if (!/^(https?|mailto):/i.test(url)) throw new Error('Only http(s)/mailto links can be opened')
    await shell.openExternal(url)
  })
  handle('shell:openPath', async (_e, p) => {
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
  })
}
