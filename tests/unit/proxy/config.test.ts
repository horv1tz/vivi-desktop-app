import { describe, expect, it } from 'vitest'
import { normalizeNoProxy, proxyEnv, resolveProxy } from '../../../src/main/proxy/config'
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
