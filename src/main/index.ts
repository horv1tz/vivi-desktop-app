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
import { VoiceOrchestrator } from './voice/orchestrator'
import { InputGuard, resolveInputDriver } from './agent/tools/drivers'
import { applyAutostart } from './app/autostart'
import { getMainWindow, isOverlayVisible } from './app/windows'

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
  if (process.env.VIVI_TRACE_QUIT === '1') {
    const origQuit = app.quit.bind(app)
    app.quit = () => {
      log.warn('app.quit called', new Error().stack)
      origQuit()
    }
  }
  electronApp.setAppUserModelId('dev.horv1tz.vivi')
  app.setName('Vivi')
  if (process.platform === 'darwin') {
    // GUI apps on macOS get a minimal PATH; the CLI's Bash tool and MCP spawns need the shell's PATH.
    try {
      const { default: fixPath } = await import('fix-path')
      fixPath()
    } catch (err) {
      log.warn('fix-path failed', err)
    }
  }

  const store = settings()
  nativeTheme.themeSource = store.get().appearance.theme
  paths.workspace(store.get().agent.workspaceDir)

  const proxy = new ProxyManager()
  await proxy.apply()
  proxy.registerIpc()

  const inputGuard = new InputGuard()
  // eslint-disable-next-line prefer-const -- assigned after auth/voice, which reference it lazily
  let agent: AgentController
  const voice = new VoiceOrchestrator({
    getSettings: () => store.get(),
    modelsDir: paths.modelsDir,
    sendToAgent: (args) => agent.send(args),
    interruptAgent: () => agent.killSwitch(),
    onAgentEvent: (listener) => agent.onEvent(listener),
    getDispatcher: () => proxy.dispatcher(),
    deliverAudioPort: (port) => {
      const win = getMainWindow()
      if (win) win.webContents.postMessage('voice:port', null, [port])
    },
    isOverlayVisible: () => isOverlayVisible(),
  })
  const inheritedConfigDir = process.env.CLAUDE_CONFIG_DIR
  /** The SDK's session helpers (listSessions, getSessionMessages) resolve the config dir from this process' env. */
  const syncConfigDirEnv = (): void => {
    if (auth.isolateConfig()) process.env.CLAUDE_CONFIG_DIR = paths.claudeConfigDir
    else if (inheritedConfigDir) process.env.CLAUDE_CONFIG_DIR = inheritedConfigDir
    else delete process.env.CLAUDE_CONFIG_DIR
  }
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
    speak: (text) => voice.speak(text),
    stopSpeaking: () => voice.stopSpeaking(),
    inputDriver: () => resolveInputDriver(),
    beforeInputAction: async () => {
      const driver = await resolveInputDriver()
      if (driver) await inputGuard.check(driver)
    },
  })
  syncConfigDirEnv()
  voice.attachAgent()
  voice.registerIpc()
  registerCoreHandlers({ mockAgent, backend: () => agent.kind })
  agent.registerIpc()
  registerAuthHandlers(auth)

  const startHidden = store.get().appearance.startMinimized || process.argv.includes('--hidden')
  const mainWin = createMainWindow({ startHidden })
  createOverlayWindow()
  mainWin.webContents.on('did-finish-load', () => voice.redeliverAudioPort())

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
      syncConfigDirEnv()
      void proxy.apply().then(() => agent.restart())
    }
  })

  const shortcutActions = {
    onOverlay: () => {
      // Hotkey = push-to-talk: opening the palette starts listening, closing it stops.
      const wasVisible = isOverlayVisible()
      toggleOverlay()
      if (store.get().voice.enabled) voice.pushToTalk(!wasVisible)
    },
    onKillSwitch: () => {
      inputGuard.trip()
      setTimeout(() => inputGuard.reset(), 5000)
      void agent.killSwitch()
      void voice.stopSpeaking()
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
    void voice.dispose()
  })
  app.on('window-all-closed', () => {
    // Keep running in the tray on every platform; quitting is explicit.
  })

  await agent.start()
  log.info(`ready (mock agent: ${mockAgent})`)

  applyAutostart(store.get().appearance.launchAtLogin, store.get().appearance.startMinimized)
  let voiceFingerprint = JSON.stringify(store.get().voice)
  let autostartFingerprint = `${store.get().appearance.launchAtLogin}:${store.get().appearance.startMinimized}`
  store.onChanged((next) => {
    const af = `${next.appearance.launchAtLogin}:${next.appearance.startMinimized}`
    if (af !== autostartFingerprint) {
      autostartFingerprint = af
      applyAutostart(next.appearance.launchAtLogin, next.appearance.startMinimized)
    }
    const fp = JSON.stringify(next.voice)
    if (fp !== voiceFingerprint) {
      voiceFingerprint = fp
      void voice.restart().catch((err) => log.warn('voice restart failed', err))
    }
  })
  if (store.get().voice.enabled && store.get().onboardingCompleted) {
    voice.start().catch((err) => log.warn('voice start failed', err))
  }
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
