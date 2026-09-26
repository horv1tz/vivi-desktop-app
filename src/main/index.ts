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
import { AuthManager } from './auth/manager'
import { registerAuthHandlers } from './auth/register'
import { resolveClaudeCliPath } from './util/claude-bin'
import { emit } from './ipc/emitters'
import { ProxyManager } from './proxy/manager'

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

  const proxy = new ProxyManager()
  await proxy.apply()
  proxy.registerIpc()

  // eslint-disable-next-line prefer-const -- assigned after auth, which references it lazily
  let agent: AgentController
  const auth: AuthManager = new AuthManager({
    claudeBinary: () => resolveClaudeCliPath(),
    claudeConfigDir: paths.claudeConfigDir,
    baseEnv: async () => ({ ...process.env }),
    onStatus: (status) => emit('auth:status', status),
    onLoginEvent: (e) => emit('auth:loginFlow', e),
    onCredentialsChanged: async () => agent.restart(),
  })
  agent = new AgentController({
    mock: mockAgent,
    getExtraEnv: async () => ({ ...proxy.envForAgent(), ...(await auth.envForAgent()) }),
    isolateConfig: () => auth.isolateConfig(),
    speak: async () => undefined,
    stopSpeaking: async () => undefined,
    inputDriver: async () => null,
  })
  registerCoreHandlers({ mockAgent })
  agent.registerIpc()
  registerAuthHandlers(auth)

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
  let agentFingerprint = agentSettingsFingerprint(store.get())
  store.onChanged((next) => {
    refreshTrayMenu(trayActions)
    registerShortcuts(shortcutActions)
    nativeTheme.themeSource = next.appearance.theme
    const fp = agentSettingsFingerprint(next)
    if (fp !== agentFingerprint) {
      agentFingerprint = fp
      log.info('agent-affecting settings changed; restarting agent process')
      void proxy.apply().then(() => agent.restart())
    }
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
    void proxy.dispose()
  })
  app.on('window-all-closed', () => {
    // Keep running in the tray on every platform; quitting is explicit.
  })

  await agent.start()
  log.info(`ready (mock agent: ${mockAgent})`)
}

/** Settings whose change requires respawning the Claude Code process. */
function agentSettingsFingerprint(s: ReturnType<typeof settings>['get'] extends () => infer R ? R : never): string {
  return JSON.stringify({ agent: s.agent, proxy: s.proxy, auth: s.auth, permissions: { ...s.permissions, alwaysAllowRules: undefined }, lang: s.appearance.language, debug: s.features.debugSdk })
}

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err)
})
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason)
})

export { destroyAllWindows }
