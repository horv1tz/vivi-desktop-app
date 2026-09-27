import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from 'electron'
import type { UpdateStatus } from '@shared/events'
import { settings } from '../settings/store'
import { showMainWindow, toggleOverlay } from './windows'
import { t } from '../i18n'
import trayIcon from '../../../resources/tray.png?asset'
import trayTemplate from '../../../resources/trayTemplate.png?asset'

let tray: Tray | null = null

export interface TrayActions {
  onToggleWakeWord: (enabled: boolean) => void
  onStop: () => void
  onInstallUpdate: () => void
  onQuit: () => void
}

/**
 * UX: the update system (Settings > About) previously had no way to tell the user an update is
 * ready without them opening that specific settings tab — a background-downloaded update could
 * sit installed-and-ready indefinitely with zero ambient indication. This surfaces it in the tray
 * menu, which is visible without opening the app at all. Pure so it's testable without a real
 * Electron Tray/Menu instance.
 */
export function updateMenuItems(
  status: UpdateStatus | null | undefined,
  onInstall: () => void,
): MenuItemConstructorOptions[] {
  if (!status) return []
  switch (status.type) {
    case 'downloaded':
      return [{ label: `${t('tray.updateReady')} ${status.version}`, click: onInstall }]
    case 'downloading':
      return [{ label: `${t('tray.updateDownloading')} ${status.percent}%`, enabled: false }]
    case 'available':
      return [{ label: `${t('tray.updateAvailable')} ${status.version}`, enabled: false }]
    default:
      return []
  }
}

export function createTray(actions: TrayActions): Tray {
  if (tray) return tray
  const image = nativeImage.createFromPath(process.platform === 'darwin' ? trayTemplate : trayIcon)
  if (process.platform === 'darwin') image.setTemplateImage(true)
  tray = new Tray(image)
  tray.setToolTip('Vivi')
  refreshTrayMenu(actions)
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
  return tray
}

export function refreshTrayMenu(actions: TrayActions, updateStatus?: UpdateStatus | null): void {
  if (!tray) return
  const s = settings().get()
  const menu = Menu.buildFromTemplate([
    { label: t('tray.open'), click: () => showMainWindow() },
    { label: t('tray.overlay'), click: () => toggleOverlay() },
    { type: 'separator' },
    {
      label: t('tray.wakeWord'),
      type: 'checkbox',
      checked: s.voice.enabled && s.voice.wakeWordEnabled,
      click: (item) => actions.onToggleWakeWord(item.checked),
    },
    { label: t('tray.stop'), click: () => actions.onStop() },
    ...updateMenuItems(updateStatus, actions.onInstallUpdate),
    { type: 'separator' },
    { label: `Vivi ${app.getVersion()}`, enabled: false },
    { label: t('tray.quit'), click: () => actions.onQuit() },
  ])
  tray.setContextMenu(menu)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
