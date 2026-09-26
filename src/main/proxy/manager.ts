import { app, net, session } from 'electron'
import { ProxyAgent, type Dispatcher } from 'undici'
import type { ProxyTestResult } from '@shared/ipc'
import { settings } from '../settings/store'
import { secrets } from '../auth/secrets'
import { proxyEnv, resolveProxy, type ResolvedProxy } from './config'
import { ProxyBridge } from './bridge'
import { handle } from '../ipc/handlers'
import { logger } from '../logging/log'

const log = logger('proxy')

export class ProxyManager {
  private bridge = new ProxyBridge()
  private resolved: ResolvedProxy | null = null
  private authHandlerInstalled = false

  /** Applies settings to Electron's network stack (renderer, net.fetch) and (re)starts the bridge. */
  async apply(): Promise<void> {
    const s = settings().get().proxy
    const password = s.hasPassword ? await secrets().get('proxyPassword') : null
    const resolved = resolveProxy(s, password)
    this.resolved = resolved
    try {
      if (resolved.mode === 'system') await session.defaultSession.setProxy({ mode: 'system' })
      else if (resolved.mode === 'none') await session.defaultSession.setProxy({ mode: 'direct' })
      else await session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: resolved.proxyRules, proxyBypassRules: resolved.proxyBypassRules })
      session.defaultSession.closeAllConnections().catch(() => undefined)
    } catch (err) {
      log.warn('session.setProxy failed', err)
    }
    if (resolved.needsBridge && resolved.upstreamUrl) await this.bridge.ensure(resolved.upstreamUrl)
    else await this.bridge.stop()
    this.installAuthHandler(s.username, password)
    log.info(`proxy mode=${resolved.mode} rules=${resolved.proxyRules || '(system)'} bridge=${this.bridge.url ?? 'off'}`)
  }

  private installAuthHandler(username: string, password: string | null): void {
    if (this.authHandlerInstalled) return
    this.authHandlerInstalled = true
    app.on('login', (event, _wc, _details, authInfo, callback) => {
      if (!authInfo.isProxy) return
      const s = settings().get().proxy
      if (!s.username) return
      event.preventDefault()
      void (async () => callback(username || s.username, password ?? (await secrets().get('proxyPassword')) ?? ''))()
    })
  }

  /** Env for the Claude Code subprocess. */
  envForAgent(): Record<string, string | undefined> {
    const s = settings().get().proxy
    const resolved = this.resolved ?? resolveProxy(s, null)
    return proxyEnv(resolved, this.bridge.url, s.caCertPath)
  }

  /** undici dispatcher for Node-side SDK clients (OpenAI etc.). */
  dispatcher(): Dispatcher | undefined {
    const r = this.resolved
    if (!r || r.mode !== 'manual') return undefined
    const url = this.bridge.url ?? r.upstreamUrl
    return url ? new ProxyAgent(url) : undefined
  }

  async test(): Promise<ProxyTestResult> {
    const started = Date.now()
    const via = this.resolved?.mode === 'manual' ? `${this.resolved.proxyRules}${this.bridge.url ? ` (bridge ${this.bridge.url})` : ''}` : this.resolved?.mode ?? 'direct'
    try {
      const res = await net.fetch('https://api.anthropic.com/v1/models', { method: 'GET', headers: { 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15_000) })
      return { ok: res.status < 500, status: res.status, latencyMs: Date.now() - started, via }
    } catch (err) {
      return { ok: false, error: (err as Error).message, latencyMs: Date.now() - started, via }
    }
  }

  registerIpc(): void {
    handle('proxy:setPassword', async (_e, password) => {
      await secrets().set('proxyPassword', password)
      settings().update({ proxy: { hasPassword: !!password } })
      await this.apply()
    })
    handle('proxy:test', () => this.test())
  }

  async dispose(): Promise<void> {
    await this.bridge.stop()
  }
}
