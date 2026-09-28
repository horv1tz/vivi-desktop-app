import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { t } from '../i18n'

export interface AppMenuActions {
  onNewChat: () => void
  onCommandPalette: () => void
  onSettings: () => void
  onOpenLogs: () => void
  onReportIssue: () => void
}

/**
 * UX-05: Electron shows its own auto-generated default menu whenever nothing calls
 * `Menu.setApplicationMenu` — that default includes "Toggle Developer Tools", reachable in a
 * shipped build with no gate at all. `isDev` drops that item (and Reload/Force Reload, which are
 * only useful for us, not an end user) from the View submenu instead of relying on the menu alone
 * — `webPreferences.devTools` (set in windows.ts) is the actual enforcement, this just avoids
 * advertising a menu item that would otherwise do nothing once that flag is off.
 * Pure and platform-parametrized so it's testable without a real Electron Menu instance.
 */
export function buildAppMenuTemplate(
  plat: NodeJS.Platform,
  isDev: boolean,
  actions: AppMenuActions,
): MenuItemConstructorOptions[] {
  const viewSubmenu: MenuItemConstructorOptions[] = [
    ...(isDev
      ? ([
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
        ] as MenuItemConstructorOptions[])
      : []),
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ]

  const helpSubmenu: MenuItemConstructorOptions[] = [
    { label: t('menu.reportIssue'), click: () => actions.onReportIssue() },
    { label: t('menu.openLogs'), click: () => actions.onOpenLogs() },
  ]

  if (plat === 'darwin') {
    return [
      {
        label: 'Vivi',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: t('menu.settings'), accelerator: 'Cmd+,', click: () => actions.onSettings() },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: t('menu.file'),
        submenu: [
          { label: t('menu.newChat'), accelerator: 'Cmd+N', click: () => actions.onNewChat() },
          {
            label: t('menu.commandPalette'),
            accelerator: 'Cmd+K',
            click: () => actions.onCommandPalette(),
          },
        ],
      },
      { role: 'editMenu' },
      { label: t('menu.view'), submenu: viewSubmenu },
      { role: 'windowMenu' },
      { role: 'help', submenu: helpSubmenu },
    ]
  }

  return [
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.newChat'), accelerator: 'Ctrl+N', click: () => actions.onNewChat() },
        {
          label: t('menu.commandPalette'),
          accelerator: 'Ctrl+K',
          click: () => actions.onCommandPalette(),
        },
        { type: 'separator' },
        { label: t('menu.settings'), accelerator: 'Ctrl+,', click: () => actions.onSettings() },
        { type: 'separator' },
        { role: 'quit', label: t('menu.quit') },
      ],
    },
    { role: 'editMenu', label: t('menu.edit') },
    { label: t('menu.view'), submenu: viewSubmenu },
    { label: t('menu.help'), submenu: helpSubmenu },
  ]
}

export function installAppMenu(isDev: boolean, actions: AppMenuActions): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildAppMenuTemplate(process.platform, isDev, actions)),
  )
}

/**
 * UX-05: Electron gives every BrowserWindow's editable fields native OS keyboard shortcuts
 * (Ctrl/Cmd+C/V/X/A) automatically, but no native right-click menu — without this, right-clicking
 * a text input anywhere in Vivi (chat composer, settings fields) shows nothing at all. Roles
 * auto-localize to the OS's own strings and auto-disable when the action isn't available (nothing
 * selected to cut/copy, empty clipboard, etc. — reflected via `params.editFlags`), so this needs
 * no translation of its own.
 */
export function attachEditContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      items.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll },
      )
    } else if (params.selectionText) {
      items.push({ role: 'copy' })
    }
    if (items.length === 0) return
    Menu.buildFromTemplate(items).popup({ window: win })
  })
}
