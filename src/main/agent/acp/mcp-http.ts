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
  private readonly sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>()
  private endpoint: McpHttpEndpoint | null = null

  constructor(private readonly deps: ViviMcpHttpServerDeps) {}

  get url(): string | null {
    return this.endpoint?.url ?? null
  }

  async start(): Promise<McpHttpEndpoint> {
    if (this.endpoint) return this.endpoint
    const server = createServer((req, res) => void this.handle(req, res))
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
    return this.endpoint
  }

  async stop(): Promise<void> {
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

  private async readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
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
      if (!this.authorized(req)) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      const sessionId = req.headers['mcp-session-id']
      const existing = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined
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
              this.sessions.set(id, { transport, server })
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
      this.deps.log?.warn('vivi MCP http error', err)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (err as Error).message }))
      else res.end()
    }
  }
}
