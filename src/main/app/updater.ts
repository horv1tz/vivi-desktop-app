/**
 * Auto-update via `electron-updater`, using the GitHub provider already configured in
 * `electron-builder.yml` (owner/repo horv1tz/vivi-desktop-app). CI (.github/workflows/build.yml)
 * publishes `latest.yml` / `latest-mac.yml` / `latest-linux.yml` alongside installers on every
 * tagged release, which is what `autoUpdater.checkForUpdates()` reads to decide if a newer
 * version exists.
 *
 * Wiring (not done here — this file is intentionally not imported by src/main/index.ts so two
 * concurrent passes don't collide on that file). Paste these lines into src/main/index.ts, after
 * `agent = new AgentController(...)` and before `registerCoreHandlers(...)`:
 *
 *   const updater = registerUpdater({ getSettings: () => store.get(), onStatus: (status) => emit('update:status', status) })
 *   updater.registerIpc()
 *   updater.checkOnStartup()
 *
 * (`emit` is already imported from './ipc/emitters' in index.ts; nothing else needs to change —
 * `registerIpc()` installs both `update:check` and `update:install` handlers itself.)
 */

import { app } from 'electron'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import type { UpdateStatus } from '@shared/events'
import type { Settings } from '@shared/settings'
import { handle } from '../ipc/handlers'
import { logger } from '../logging/log'

const log = logger('updater')

export interface UpdaterDeps {
  getSettings: () => Settings
  onStatus: (status: UpdateStatus) => void
}

/**
 * `electron-updater`'s CJS build exports `autoUpdater` via a multi-line `Object.defineProperty`
 * getter that cjs-module-lexer (and therefore Node's ESM/CJS interop) does not pick up as a
 * static named export — only the synthesized `default` (the whole CJS `exports` object) carries
 * it reliably. We fall back to a bare `autoUpdater` property too so a simpler test mock (one that
 * doesn't bother wrapping its fake module in `{ default: ... }`) still works.
 */
async function loadAutoUpdaterModule(): Promise<AppUpdater | null> {
  const mod = (await import('electron-updater')) as unknown as { default?: { autoUpdater?: AppUpdater }; autoUpdater?: AppUpdater }
  return mod.default?.autoUpdater ?? mod.autoUpdater ?? null
}

/**
 * Thin, testable wrapper around `electron-updater`'s `autoUpdater`. Reports state through the
 * `onStatus` callback (constructor dep) instead of importing the IPC layer directly, mirroring
 * AuthManager's `onStatus`/`onLoginEvent` callbacks and ProxyManager's `getSettings`-style deps.
 */
export class Updater {
  private instance: AppUpdater | null = null
  private eventsWired = false
  /** Gates 'checking'/'not-available' noise for the silent startup check; see checkForUpdates. */
  private silentCheck = false

  constructor(private readonly deps: UpdaterDeps) {}

  private reportError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    log.error(message)
    this.deps.onStatus({ type: 'error', message })
  }

  /** Loads (and memoizes) the real autoUpdater instance; never touched outside a packaged app. */
  private async load(): Promise<AppUpdater | null> {
    if (this.instance) return this.instance
    try {
      const au = await loadAutoUpdaterModule()
      if (!au) {
        log.error('electron-updater did not expose autoUpdater')
        return null
      }
      // We drive downloads explicitly (see checkForUpdates/downloadUpdate) instead of letting
      // electron-updater start one the moment it finds a release.
      au.autoDownload = false
      if (!this.eventsWired) {
        this.eventsWired = true
        au.on('checking-for-update', () => {
          if (!this.silentCheck) this.deps.onStatus({ type: 'checking' })
        })
        au.on('update-available', (info: UpdateInfo) => this.deps.onStatus({ type: 'available', version: info.version }))
        au.on('update-not-available', () => {
          if (!this.silentCheck) this.deps.onStatus({ type: 'not-available' })
        })
        au.on('download-progress', (p: ProgressInfo) => this.deps.onStatus({ type: 'downloading', percent: Math.round(p.percent) }))
        au.on('update-downloaded', (info: UpdateInfo) => this.deps.onStatus({ type: 'downloaded', version: info.version }))
        au.on('error', (err: Error) => this.reportError(err))
      }
      this.instance = au
      return au
    } catch (err) {
      this.reportError(err)
      return null
    }
  }

  /** electron-updater errors loudly outside a packaged app; never call it in dev. */
  private guardPackaged(action: string): boolean {
    if (app.isPackaged) return true
    log.info(`skipping ${action}: app is not packaged (dev mode)`)
    return false
  }

  private guardEnabled(action: string): boolean {
    if (!this.guardPackaged(action)) return false
    if (!this.deps.getSettings().features.autoUpdate) {
      log.info(`skipping ${action}: features.autoUpdate is disabled in settings`)
      return false
    }
    return true
  }

  /**
   * Checks for a new release. `silent` is true for the once-per-launch startup check: it only
   * ever surfaces an 'available' update or an 'error' — never the "checking" / "you're already
   * up to date" chatter, so Vivi doesn't nag on every launch. A manual, button-triggered check
   * (silent: false) reports every step, including "up to date".
   */
  async checkForUpdates(opts: { silent: boolean }): Promise<void> {
    if (!this.guardEnabled('checkForUpdates')) return
    this.silentCheck = opts.silent
    const au = await this.load()
    if (!au) return
    try {
      const result = await au.checkForUpdates()
      if (result?.isUpdateAvailable) {
        // autoDownload is off; a check the user asked for (or one Vivi is allowed to run in the
        // background per the autoUpdate setting) is taken as consent to fetch the update so it's
        // ready to install — the only further confirmation required is quitAndInstall().
        await this.downloadUpdate()
      }
    } catch (err) {
      this.reportError(err)
    }
  }

  /** Triggers the actual download; safe to call directly (e.g. from a future "download now" UI). */
  async downloadUpdate(): Promise<void> {
    if (!this.guardEnabled('downloadUpdate')) return
    const au = await this.load()
    if (!au) return
    try {
      await au.downloadUpdate()
    } catch (err) {
      this.reportError(err)
    }
  }

  /** Restarts and installs an already-downloaded update. */
  async quitAndInstall(): Promise<void> {
    if (!this.guardPackaged('quitAndInstall')) return
    const au = await this.load()
    au?.quitAndInstall()
  }

  registerIpc(): void {
    handle('update:check', () => this.checkForUpdates({ silent: false }))
    handle('update:install', () => this.quitAndInstall())
  }

  /** Fire-and-forget silent check for use right after startup. */
  checkOnStartup(): void {
    void this.checkForUpdates({ silent: true })
  }
}

export interface UpdaterHandle {
  updater: Updater
  registerIpc: () => void
  checkOnStartup: () => void
}

export function registerUpdater(deps: UpdaterDeps): UpdaterHandle {
  const updater = new Updater(deps)
  return {
    updater,
    registerIpc: () => updater.registerIpc(),
    checkOnStartup: () => updater.checkOnStartup(),
  }
}
