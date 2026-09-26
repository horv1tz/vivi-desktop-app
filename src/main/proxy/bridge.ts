import { Server } from 'proxy-chain'
import { logger } from '../logging/log'

const log = logger('proxy-bridge')

/**
 * Local HTTP proxy that forwards to an upstream SOCKS5 or authenticated HTTP proxy.
 * The Claude Code CLI only speaks plain HTTP(S) proxies via HTTPS_PROXY and does not support
 * SOCKS, so the bridge translates; it also keeps the proxy password out of the child's env.
 */
export class ProxyBridge {
  private server: Server | null = null
  private upstream: string | null = null
  private _url: string | null = null

  get url(): string | null {
    return this._url
  }

  async ensure(upstreamUrl: string): Promise<string> {
    if (this.server && this.upstream === upstreamUrl && this._url) return this._url
    await this.stop()
    const server = new Server({
      port: 0,
      host: '127.0.0.1',
      verbose: false,
      prepareRequestFunction: () => ({ upstreamProxyUrl: upstreamUrl, requestAuthentication: false }),
    })
    await server.listen()
    this.server = server
    this.upstream = upstreamUrl
    this._url = `http://127.0.0.1:${server.port}`
    log.info(`bridge listening on ${this._url} → ${upstreamUrl.replace(/\/\/[^@]*@/, '//***@')}`)
    return this._url
  }

  async stop(): Promise<void> {
    const s = this.server
    this.server = null
    this._url = null
    this.upstream = null
    if (s) await s.close(true).catch((err: unknown) => log.warn('bridge close failed', err))
  }
}
