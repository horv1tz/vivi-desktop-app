import { request } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ViviMcpHttpServer, isIdleSessionExpired } from '../../../src/main/agent/acp/mcp-http'

function send(opts: {
  port: number
  method?: string
  headers?: Record<string, string>
  body?: string
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: opts.port,
        path: '/mcp',
        method: opts.method ?? 'POST',
        headers: opts.headers,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        )
      },
    )
    req.on('error', reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

describe('isIdleSessionExpired', () => {
  it('expires a session once it has been idle for the TTL', () => {
    const start = 1_000_000
    expect(isIdleSessionExpired(start, start + 29 * 60_000)).toBe(false)
    expect(isIdleSessionExpired(start, start + 30 * 60_000)).toBe(true)
  })
})

describe('ViviMcpHttpServer (ACP-08)', () => {
  let server: ViviMcpHttpServer | null = null

  afterEach(async () => {
    await server?.stop()
    server = null
  })

  async function makeServer(): Promise<{ port: number; token: string }> {
    server = new ViviMcpHttpServer({
      createServer: () => new McpServer({ name: 'test', version: '0.0.0' }),
    })
    const ep = await server.start()
    const port = Number(new URL(ep.url).port)
    return { port, token: server.bearerToken }
  }

  it('rejects a request carrying an Origin header, the browser-only DNS-rebinding signal', async () => {
    const { port, token } = await makeServer()
    const res = await send({
      port,
      headers: {
        authorization: `Bearer ${token}`,
        origin: 'http://evil.example',
        'content-type': 'application/json',
      },
      body: '{}',
    })
    expect(res.status).toBe(403)
  })

  it('rejects a request whose Host header does not name this exact server', async () => {
    const { port, token } = await makeServer()
    const res = await send({
      port,
      headers: {
        authorization: `Bearer ${token}`,
        host: 'evil.example',
        'content-type': 'application/json',
      },
      body: '{}',
    })
    expect(res.status).toBe(403)
  })

  it('rejects a request without the bearer token', async () => {
    const { port } = await makeServer()
    const res = await send({ port, headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(401)
  })

  it('rejects a body larger than the configured cap', async () => {
    const { port, token } = await makeServer()
    const body = 'x'.repeat(11 * 1024 * 1024)
    const res = await send({
      port,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body,
    })
    expect(res.status).toBe(413)
  })

  it('accepts a same-origin, authorized, small request past the guards (reaches session handling)', async () => {
    const { port, token } = await makeServer()
    const res = await send({
      port,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    })
    // Not an initialize request and no session id: rejected by the MCP session logic, not the guards above.
    expect(res.status).toBe(400)
    expect(res.body).toContain('no valid session')
  })
})
