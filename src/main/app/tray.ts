import { Menu, Tray, app, nativeImage } from 'electron'
import { settings } from '../settings/store'
import { showMainWindow, toggleOverlay } from './windows'
import { t } from '../i18n'
import trayIcon from '../../../resources/tray.png?asset'
import trayTemplate from '../../../resources/trayTemplate.png?asset'

let tray: Tray | null = null

export interface TrayActions {
  onToggleWakeWord: (enabled: boolean) => void
  onStop: () => void
  onQuit: () => void
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

export function refreshTrayMenu(actions: TrayActions): void {
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
