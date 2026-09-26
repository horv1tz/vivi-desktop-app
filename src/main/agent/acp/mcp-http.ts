import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

export interface McpHttpEndpoint {
  url: string
  headers: { name: string; value: string }[]
}

class PayloadTooLargeError extends Error {}

export function isIdleSessionExpired(lastActivity: number, now: number): boolean {
  return now - lastActivity >= SESSION_TTL_MS
}

/** Env var through which the bearer token reaches the Claude CLI (it expands ${VAR} in MCP headers), keeping it out of argv. */
export const MCP_TOKEN_ENV = 'VIVI_MCP_TOKEN'

/** ACP-08: bounds so a slow, huge, or abandoned connection can't tie up the local endpoint indefinitely. */
const MAX_BODY_BYTES = 10 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000
const SESSION_TTL_MS = 30 * 60_000
const SESSION_SWEEP_INTERVAL_MS = 5 * 60_000

export interface ViviMcpHttpServerDeps {
  /** Creates a fresh MCP server instance (one per MCP session). */
  createServer: () => McpServer
  log?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; debug: (...a: unknown[]) => void }
}

/**
 * Serves Vivi's in-process tools over Streamable HTTP on 127.0.0.1 so an external ACP agent
 * (which runs in its own process and cannot use in-process MCP servers) can call them.
 * Access requires a bearer token that only the spawned agent receives.
 */
export class ViviMcpHttpServer {
  private server: Server | null = null
  private readonly token = randomBytes(24).toString('hex')
  private readonly sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; lastActivity: number }>()
  private endpoint: McpHttpEndpoint | null = null
  private starting: Promise<McpHttpEndpoint> | null = null
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: ViviMcpHttpServerDeps) {}

  get url(): string | null {
    return this.endpoint?.url ?? null
  }

  /** The bearer token expected on every request (hand it to the agent via its environment). */
  get bearerToken(): string {
    return this.token
  }

  /**
   * Endpoint description for an agent. `viaEnv` substitutes a `${VIVI_MCP_TOKEN}` placeholder that
   * Claude Code expands from the agent's environment, so the secret never appears on a command line.
   */
  async endpointFor(viaEnv: boolean): Promise<McpHttpEndpoint> {
    const ep = await this.start()
    return viaEnv ? { url: ep.url, headers: [{ name: 'Authorization', value: `Bearer \${${MCP_TOKEN_ENV}}` }] } : ep
  }

  start(): Promise<McpHttpEndpoint> {
    if (this.endpoint) return Promise.resolve(this.endpoint)
    if (this.starting) return this.starting
    this.starting = this.listen().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async listen(): Promise<McpHttpEndpoint> {
    const server = createServer((req, res) => void this.handle(req, res))
    // ACP-08: bound how long a connection may take, so a stalled or malicious client can't hold a
    // socket (and the event loop's attention) open indefinitely.
    server.requestTimeout = REQUEST_TIMEOUT_MS
    server.headersTimeout = REQUEST_TIMEOUT_MS
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const { port } = server.address() as AddressInfo
    this.endpoint = { url: `http://127.0.0.1:${port}/mcp`, headers: [{ name: 'Authorization', value: `Bearer ${this.token}` }] }
    this.deps.log?.debug(`vivi MCP endpoint listening on ${this.endpoint.url}`)
    this.sweepTimer = setInterval(() => void this.sweepIdleSessions(), SESSION_SWEEP_INTERVAL_MS)
    this.sweepTimer.unref?.()
    return this.endpoint
  }

  /** ACP-08: reaps sessions the agent abandoned without a clean close (e.g. it crashed mid-turn). */
  private async sweepIdleSessions(): Promise<void> {
    const now = Date.now()
    for (const [id, s] of this.sessions) {
      if (!isIdleSessionExpired(s.lastActivity, now)) continue
      this.sessions.delete(id)
      this.deps.log?.debug(`vivi MCP session ${id} timed out after ${SESSION_TTL_MS}ms idle`)
      await s.transport.close().catch(() => undefined)
      await s.server.close().catch(() => undefined)
    }
  }

  async stop(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined)
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
    for (const [id, s] of this.sessions) {
      this.sessions.delete(id)
      await s.transport.close().catch(() => undefined)
      await s.server.close().catch(() => undefined)
    }
    const server = this.server
    this.server = null
    this.endpoint = null
    if (server) await new Promise<void>((r) => server.close(() => r()))
  }

  private authorized(req: IncomingMessage): boolean {
    const auth = req.headers.authorization ?? ''
    return auth === `Bearer ${this.token}`
  }

  /**
   * ACP-08: guards against DNS rebinding / a browser tab reaching this loopback-only endpoint.
   * The real caller is the ACP adapter's own HTTP MCP client, which never sends an `Origin` header
   * (that header is a browser fetch/XHR concept) — so ANY `Origin` on a request is itself the
   * signal of an untrusted caller, not just a mismatched one. `Host` must also name this exact
   * server, not merely resolve to 127.0.0.1 (which a rebound DNS name would still do).
   */
  private originAllowed(req: IncomingMessage): boolean {
    if (req.headers.origin !== undefined) return false
    const host = req.headers.host
    return typeof host === 'string' && host === `127.0.0.1:${(this.server?.address() as AddressInfo | null)?.port}`
  }

  private async readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    let total = 0
    for await (const c of req) {
      const buf = c as Buffer
      total += buf.length
      // ACP-08: cap the body so a slow/huge upload can't exhaust memory before JSON.parse even runs.
      if (total > MAX_BODY_BYTES) throw new PayloadTooLargeError()
      chunks.push(buf)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    return text ? JSON.parse(text) : undefined
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/mcp') {
        res.writeHead(404).end()
        return
      }
      if (!this.originAllowed(req)) {
        res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'forbidden' }))
        return
      }
      if (!this.authorized(req)) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      const sessionId = req.headers['mcp-session-id']
      const existing = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined
      if (existing) existing.lastActivity = Date.now()
      if (req.method === 'POST') {
        const body = await this.readBody(req)
        if (existing) {
          await existing.transport.handleRequest(req, res, body)
          return
        }
        if (!sessionId && isInitializeRequest(body)) {
          const server = this.deps.createServer()
          const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string): void => {
              this.sessions.set(id, { transport, server, lastActivity: Date.now() })
            },
          })
          transport.onclose = () => {
            if (transport.sessionId) this.sessions.delete(transport.sessionId)
          }
          await server.connect(transport)
          await transport.handleRequest(req, res, body)
          return
        }
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad request: no valid session' }, id: null }))
        return
      }
      if ((req.method === 'GET' || req.method === 'DELETE') && existing) {
        await existing.transport.handleRequest(req, res)
        return
      }
      res.writeHead(existing ? 405 : 400).end()
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        if (!res.headersSent) res.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'payload too large' }))
        else res.end()
        return
      }
      this.deps.log?.warn('vivi MCP http error', err)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (err as Error).message }))
      else res.end()
    }
  }
}
