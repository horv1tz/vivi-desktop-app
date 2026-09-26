import type { ProxySettings } from '@shared/settings'

export interface ResolvedProxy {
  /** Upstream URL with credentials, e.g. http://user:pass@host:8080 or socks5://host:1080. */
  upstreamUrl: string | null
  /** Proxy rules string for Electron session.setProxy. */
  proxyRules: string
  proxyBypassRules: string
  /** True when the CLI subprocess cannot use the upstream directly (SOCKS or authenticated). */
  needsBridge: boolean
  mode: ProxySettings['mode']
}

export function resolveProxy(settings: ProxySettings, password: string | null): ResolvedProxy {
  if (settings.mode === 'none') return { upstreamUrl: null, proxyRules: 'direct://', proxyBypassRules: '', needsBridge: false, mode: 'none' }
  if (settings.mode === 'system') return { upstreamUrl: null, proxyRules: '', proxyBypassRules: settings.bypass, needsBridge: false, mode: 'system' }
  if (!settings.host || !settings.port) return { upstreamUrl: null, proxyRules: 'direct://', proxyBypassRules: '', needsBridge: false, mode: 'none' }
  const auth = settings.username ? `${encodeURIComponent(settings.username)}${password ? `:${encodeURIComponent(password)}` : ''}@` : ''
  const upstreamUrl = `${settings.scheme}://${auth}${settings.host}:${settings.port}`
  const proxyRules = `${settings.scheme === 'socks5' ? 'socks5' : settings.scheme}://${settings.host}:${settings.port}`
  const needsBridge = settings.scheme === 'socks5' || !!settings.username
  return { upstreamUrl, proxyRules, proxyBypassRules: settings.bypass, needsBridge, mode: 'manual' }
}

/** Env vars for the Claude Code subprocess. `bridgeUrl` replaces the upstream when a local bridge runs. */
export function proxyEnv(resolved: ResolvedProxy, bridgeUrl: string | null, caCertPath: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  if (resolved.mode === 'manual') {
    const url = bridgeUrl ?? resolved.upstreamUrl ?? undefined
    env.HTTPS_PROXY = url
    env.HTTP_PROXY = url
    env.https_proxy = url
    env.http_proxy = url
    env.NO_PROXY = normalizeNoProxy(resolved.proxyBypassRules)
    env.no_proxy = env.NO_PROXY
  } else if (resolved.mode === 'none') {
    // Explicitly clear inherited proxy settings so "none" really means direct.
    env.HTTPS_PROXY = undefined
    env.HTTP_PROXY = undefined
    env.https_proxy = undefined
    env.http_proxy = undefined
  }
  env.NODE_EXTRA_CA_CERTS = caCertPath || undefined
  return env
}

export function normalizeNoProxy(bypass: string): string {
  return bypass
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s === '<local>' ? 'localhost,127.0.0.1,::1' : s))
    .join(',')
}
