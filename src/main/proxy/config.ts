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
  if (settings.mode === 'none')
    return {
      upstreamUrl: null,
      proxyRules: 'direct://',
      proxyBypassRules: '',
      needsBridge: false,
      mode: 'none',
    }
  if (settings.mode === 'system')
    return {
      upstreamUrl: null,
      proxyRules: '',
      proxyBypassRules: settings.bypass,
      needsBridge: false,
      mode: 'system',
    }
  if (!settings.host || !settings.port)
    return {
      upstreamUrl: null,
      proxyRules: 'direct://',
      proxyBypassRules: '',
      needsBridge: false,
      mode: 'none',
    }
  const auth = settings.username
    ? `${encodeURIComponent(settings.username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : ''
  const upstreamUrl = `${settings.scheme}://${auth}${settings.host}:${settings.port}`
  const proxyRules = `${settings.scheme === 'socks5' ? 'socks5' : settings.scheme}://${settings.host}:${settings.port}`
  const needsBridge = settings.scheme === 'socks5' || !!settings.username
  return { upstreamUrl, proxyRules, proxyBypassRules: settings.bypass, needsBridge, mode: 'manual' }
}

/**
 * UX-02: "system" mode only ever configured Electron's own network stack
 * (`session.setProxy({mode:'system'})`) — the Claude CLI is a separate subprocess that doesn't go
 * through that session at all and only ever sees a real proxy via HTTPS_PROXY/HTTP_PROXY env vars.
 * Without this, "system" mode silently left the CLI on a direct connection even on a network that
 * requires a proxy. `ProxyManager.apply()` resolves the OS/PAC proxy for a real URL via
 * `session.resolveProxy()` and folds the result into `ResolvedProxy` via this function before
 * `proxyEnv()` runs, so the same upstream/bridge machinery manual mode already uses just works.
 */
export function applySystemProxyResolution(base: ResolvedProxy, raw: string): ResolvedProxy {
  const parsed = parseResolvedProxyString(raw)
  if (!parsed) return { ...base, upstreamUrl: null, needsBridge: false }
  return {
    ...base,
    upstreamUrl: `${parsed.scheme}://${parsed.host}:${parsed.port}`,
    needsBridge: parsed.scheme === 'socks5',
  }
}

/**
 * Parses one entry of Electron's `session.resolveProxy()` result, e.g. "PROXY host:8080",
 * "SOCKS5 host:1080", or "DIRECT" (and "HTTPS host:443", used by some PAC scripts). Multiple
 * space/semicolon-free fallback entries are separated by `;`; only the first is used, matching
 * how a plain HTTP client without failover would behave.
 */
export function parseResolvedProxyString(
  raw: string,
): { scheme: 'http' | 'socks5'; host: string; port: number } | null {
  const first = raw.split(';')[0]?.trim() ?? ''
  const m = /^(PROXY|HTTPS|SOCKS5?|SOCKS4A?)\s+([^\s:]+):(\d+)$/i.exec(first)
  if (!m) return null
  const scheme = m[1]!.toUpperCase().startsWith('SOCKS') ? 'socks5' : 'http'
  return { scheme, host: m[2]!, port: Number(m[3]) }
}

/** Env vars for the Claude Code subprocess. `bridgeUrl` replaces the upstream when a local bridge runs. */
export function proxyEnv(
  resolved: ResolvedProxy,
  bridgeUrl: string | null,
  caCertPath: string,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  if (resolved.mode === 'manual' || (resolved.mode === 'system' && resolved.upstreamUrl)) {
    const url = bridgeUrl ?? resolved.upstreamUrl ?? undefined
    env.HTTPS_PROXY = url
    env.HTTP_PROXY = url
    env.https_proxy = url
    env.http_proxy = url
    env.NO_PROXY = normalizeNoProxy(resolved.proxyBypassRules)
    env.no_proxy = env.NO_PROXY
  } else if (resolved.mode === 'none' || resolved.mode === 'system') {
    // Explicitly clear inherited proxy settings: "none" always means direct, and an unresolvable
    // or DIRECT system result means the OS itself says no proxy is needed for this connection.
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
