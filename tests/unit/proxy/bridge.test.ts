import { createServer, request, type IncomingMessage, type Server as HttpServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Server as UpstreamProxy } from 'proxy-chain'

vi.mock('../../../src/main/logging/log', () => ({
  logger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}))

const { ProxyBridge } = await import('../../../src/main/proxy/bridge')

let origin: HttpServer
let originPort = 0
let upstream: UpstreamProxy
let upstreamHits = 0

beforeAll(async () => {
  origin = createServer((_req, res) => res.end('hello-from-origin'))
  await new Promise<void>((r) => origin.listen(0, '127.0.0.1', () => r()))
  originPort = (origin.address() as { port: number }).port
  upstream = new UpstreamProxy({
    port: 0,
    host: '127.0.0.1',
    prepareRequestFunction: () => {
      upstreamHits++
      return { requestAuthentication: false }
    },
  })
  await upstream.listen()
})

afterAll(async () => {
  await upstream.close(true)
  await new Promise<void>((r) => origin.close(() => r()))
})

describe('ProxyBridge', () => {
  it('forwards requests through the upstream proxy', async () => {
    const bridge = new ProxyBridge()
    const url = await bridge.ensure(`http://127.0.0.1:${upstream.port}`)
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    // Plain HTTP through a forward proxy: request the absolute URL from the bridge.
    const bridgePort = Number(new URL(url).port)
    const body = await new Promise<string>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: bridgePort,
          method: 'GET',
          path: `http://127.0.0.1:${originPort}/`,
          headers: { Host: `127.0.0.1:${originPort}` },
        },
        (res: IncomingMessage) => {
          let data = ''
          res.on('data', (c: Buffer) => (data += c.toString()))
          res.on('end', () => resolve(data))
        },
      )
      req.on('error', reject)
      req.end()
    })
    expect(body).toBe('hello-from-origin')
    expect(upstreamHits).toBeGreaterThan(0)
    await bridge.stop()
    expect(bridge.url).toBeNull()
  })
})
