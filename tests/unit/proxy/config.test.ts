import { describe, expect, it } from 'vitest'
import {
  applySystemProxyResolution,
  normalizeNoProxy,
  parseResolvedProxyString,
  proxyEnv,
  resolveProxy,
  type ResolvedProxy,
} from '../../../src/main/proxy/config'
import { defaultSettings } from '../../../src/shared/settings'

const base = () => defaultSettings().proxy

describe('resolveProxy', () => {
  it('direct when none', () => {
    const r = resolveProxy(base(), null)
    expect(r.mode).toBe('none')
    expect(r.proxyRules).toBe('direct://')
    expect(r.needsBridge).toBe(false)
  })

  it('plain http proxy needs no bridge', () => {
    const r = resolveProxy(
      { ...base(), mode: 'manual', scheme: 'http', host: 'p.local', port: 3128 },
      null,
    )
    expect(r.upstreamUrl).toBe('http://p.local:3128')
    expect(r.proxyRules).toBe('http://p.local:3128')
    expect(r.needsBridge).toBe(false)
  })

  it('socks5 and authenticated proxies need the bridge and encode credentials', () => {
    const r = resolveProxy(
      {
        ...base(),
        mode: 'manual',
        scheme: 'socks5',
        host: '10.0.0.1',
        port: 1080,
        username: 'us er',
        hasPassword: true,
      },
      'p@ss',
    )
    expect(r.upstreamUrl).toBe('socks5://us%20er:p%40ss@10.0.0.1:1080')
    expect(r.proxyRules).toBe('socks5://10.0.0.1:1080')
    expect(r.needsBridge).toBe(true)
  })
})

describe('proxyEnv', () => {
  it('uses the bridge url for the CLI when present and normalizes NO_PROXY', () => {
    const r = resolveProxy(
      {
        ...base(),
        mode: 'manual',
        scheme: 'socks5',
        host: 'h',
        port: 1,
        bypass: 'localhost, <local>;*.corp',
      },
      null,
    )
    const env = proxyEnv(r, 'http://127.0.0.1:4444', '/ca.pem')
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:4444')
    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:4444')
    expect(env.NO_PROXY).toBe('localhost,localhost,127.0.0.1,::1,*.corp')
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/ca.pem')
  })

  it('clears inherited proxy vars in none mode', () => {
    const env = proxyEnv(resolveProxy(base(), null), null, '')
    expect('HTTPS_PROXY' in env).toBe(true)
    expect(env.HTTPS_PROXY).toBeUndefined()
    expect(env.NODE_EXTRA_CA_CERTS).toBeUndefined()
  })

  it('normalizeNoProxy handles separators', () => {
    expect(normalizeNoProxy('a; b,c  d')).toBe('a,b,c,d')
  })
})

describe('parseResolvedProxyString (UX-02)', () => {
  it('parses a plain PROXY entry', () => {
    expect(parseResolvedProxyString('PROXY proxy.corp.local:8080')).toEqual({
      scheme: 'http',
      host: 'proxy.corp.local',
      port: 8080,
    })
  })

  it('parses SOCKS/SOCKS5/SOCKS4A as socks5', () => {
    expect(parseResolvedProxyString('SOCKS5 s.local:1080')).toEqual({
      scheme: 'socks5',
      host: 's.local',
      port: 1080,
    })
    expect(parseResolvedProxyString('SOCKS s.local:1080')?.scheme).toBe('socks5')
  })

  it('takes only the first fallback entry when several are given', () => {
    expect(parseResolvedProxyString('PROXY a.local:80; PROXY b.local:81; DIRECT')).toEqual({
      scheme: 'http',
      host: 'a.local',
      port: 80,
    })
  })

  it('returns null for DIRECT or an unparseable string', () => {
    expect(parseResolvedProxyString('DIRECT')).toBeNull()
    expect(parseResolvedProxyString('')).toBeNull()
    expect(parseResolvedProxyString('garbage')).toBeNull()
  })
})

describe('applySystemProxyResolution (UX-02)', () => {
  const systemBase: ResolvedProxy = {
    upstreamUrl: null,
    proxyRules: '',
    proxyBypassRules: 'localhost',
    needsBridge: false,
    mode: 'system',
  }

  it('resolves a plain HTTP system proxy into an upstream URL the CLI can use directly', () => {
    const r = applySystemProxyResolution(systemBase, 'PROXY proxy.corp.local:8080')
    expect(r.upstreamUrl).toBe('http://proxy.corp.local:8080')
    expect(r.needsBridge).toBe(false)
    expect(r.mode).toBe('system')
  })

  it('routes a SOCKS system proxy through the bridge, like manual SOCKS does', () => {
    const r = applySystemProxyResolution(systemBase, 'SOCKS5 s.local:1080')
    expect(r.upstreamUrl).toBe('socks5://s.local:1080')
    expect(r.needsBridge).toBe(true)
  })

  it('leaves the CLI on a direct connection when the OS says DIRECT', () => {
    const r = applySystemProxyResolution(systemBase, 'DIRECT')
    expect(r.upstreamUrl).toBeNull()
    expect(r.needsBridge).toBe(false)
  })
})

describe('proxyEnv in system mode (UX-02)', () => {
  it('sets HTTPS_PROXY/HTTP_PROXY once system mode resolves to a concrete upstream', () => {
    const resolved: ResolvedProxy = {
      upstreamUrl: 'http://proxy.corp.local:8080',
      proxyRules: '',
      proxyBypassRules: 'localhost',
      needsBridge: false,
      mode: 'system',
    }
    const env = proxyEnv(resolved, null, '')
    expect(env.HTTPS_PROXY).toBe('http://proxy.corp.local:8080')
    expect(env.HTTP_PROXY).toBe('http://proxy.corp.local:8080')
  })

  it('uses the bridge URL when the system proxy needed one (SOCKS)', () => {
    const resolved: ResolvedProxy = {
      upstreamUrl: 'socks5://s.local:1080',
      proxyRules: '',
      proxyBypassRules: '',
      needsBridge: true,
      mode: 'system',
    }
    const env = proxyEnv(resolved, 'http://127.0.0.1:5555', '')
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:5555')
  })

  it('clears proxy env vars when system mode resolves to no proxy at all', () => {
    const resolved: ResolvedProxy = {
      upstreamUrl: null,
      proxyRules: '',
      proxyBypassRules: '',
      needsBridge: false,
      mode: 'system',
    }
    const env = proxyEnv(resolved, null, '')
    expect('HTTPS_PROXY' in env).toBe(true)
    expect(env.HTTPS_PROXY).toBeUndefined()
  })
})
