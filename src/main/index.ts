import { app, nativeTheme, Notification } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { initLogging, logger } from './logging/log'
import { settings } from './settings/store'
import { createMainWindow, createOverlayWindow, destroyAllWindows, markQuitting, showMainWindow, toggleOverlay } from './app/windows'
import { createTray, destroyTray, refreshTrayMenu } from './app/tray'
import { registerShortcuts, unregisterShortcuts } from './app/shortcuts'
import { registerCoreHandlers } from './ipc/register-core'
import { AgentController } from './agent/controller'
import { t } from './i18n'
import { paths } from './util/paths'

const log = logger('main')

const mockAgent = process.env.VIVI_MOCK_AGENT === '1'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  initLogging()
  electronApp.setAppUserModelId('dev.horv1tz.vivi')
  app.setName('Vivi')

  const store = settings()
  nativeTheme.themeSource = store.get().appearance.theme
  paths.workspace(store.get().agent.workspaceDir)

  const agent = new AgentController({ mock: mockAgent })
  registerCoreHandlers({ mockAgent })
  agent.registerIpc()

  const startHidden = store.get().appearance.startMinimized
  createMainWindow({ startHidden })
  createOverlayWindow()

  const trayActions = {
    onToggleWakeWord: (enabled: boolean) => {
      store.update({ voice: { wakeWordEnabled: enabled } })
    },
    onQuit: () => {
      markQuitting()
      app.quit()
    },
  }
  createTray(trayActions)
  store.onChanged(() => {
    refreshTrayMenu(trayActions)
    registerShortcuts(shortcutActions)
  })

  const shortcutActions = {
    onOverlay: () => toggleOverlay(),
    onKillSwitch: () => {
      void agent.killSwitch()
      if (Notification.isSupported()) new Notification({ title: 'Vivi', body: t('notify.killSwitch') }).show()
    },
  }
  registerShortcuts(shortcutActions)

  app.on('browser-window-created', (_e, win) => optimizer.watchWindowShortcuts(win))
  app.on('activate', () => showMainWindow())
  app.on('before-quit', () => markQuitting())
  app.on('will-quit', () => {
    unregisterShortcuts()
    destroyTray()
    void agent.dispose()
  })
  app.on('window-all-closed', () => {
    // Keep running in the tray on every platform; quitting is explicit.
  })

  await agent.start()
  log.info(`ready (mock agent: ${mockAgent})`)
}

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err)
})
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason)
})

export { destroyAllWindows }
