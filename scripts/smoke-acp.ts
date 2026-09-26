// End-to-end check of the ACP path outside Electron: spawns the bundled claude-agent-acp adapter with
// the machine's Claude Code login, opens a session with a local MCP-less config and runs one prompt.
//   VIVI_CLAUDE_BIN=/path/to/claude npx tsx scripts/smoke-acp.ts
import { createRequire } from 'node:module'
import { ClientSideConnection, PROTOCOL_VERSION, type Client } from '@agentclientprotocol/sdk'
import { spawnAcpProcess } from '../src/main/agent/acp/process'
import { AcpTranslator } from '../src/main/agent/acp/translate'

const require = createRequire(import.meta.url)
const entry = require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
const claude = process.env.VIVI_CLAUDE_BIN
const cwd = process.env.VIVI_SMOKE_CWD ?? process.cwd()

async function main(): Promise<void> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const k of ['CLAUDE_SESSION_ID', 'CLAUDECODE', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CODE_REMOTE']) delete env[k]
  if (claude) env.CLAUDE_CODE_EXECUTABLE = claude
  const proc = spawnAcpProcess({
    command: process.execPath,
    args: [entry],
    env,
    cwd,
    onStderr: (l) => console.error('[acp-stderr]', l),
    onExit: (i) => console.error('[acp] exited', i),
  })
  const translator = new AcpTranslator({ emit: (e) => console.log('[event]', JSON.stringify(e).slice(0, 300)) })
  let sessionId = ''
  const client: Client = {
    requestPermission: async (params) => {
      console.log('[permission]', params.toolCall.title, params.options.map((o) => `${o.kind}:${o.optionId}`).join(','))
      const allow = params.options.find((o) => o.kind === 'allow_once') ?? params.options[0]!
      return { outcome: { outcome: 'selected', optionId: allow.optionId } }
    },
    sessionUpdate: async (params) => {
      if (params.sessionId === sessionId) translator.handle(params)
    },
    createElicitation: async () => ({ action: 'cancel' }),
    extNotification: async (method, params) => console.log('[ext]', method, JSON.stringify(params).slice(0, 200)),
  }
  const conn = new ClientSideConnection(() => client, proc.stream)
  const init = await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} } }, clientInfo: { name: 'vivi-smoke', version: '0.0.0' } })
  console.log('[init]', JSON.stringify({ agent: init.agentInfo, caps: init.agentCapabilities, auth: init.authMethods?.map((a) => a.id) }))
  const t0 = Date.now()
  const session = await conn.newSession({
    cwd,
    mcpServers: [],
    _meta: { claudeCode: { options: { settingSources: [], maxTurns: 4, allowDangerouslySkipPermissions: false, systemPrompt: 'You are a terse test assistant.', allowedTools: ['Read', 'Glob', 'Bash'] } } },
  })
  sessionId = session.sessionId
  console.log('[session]', sessionId, 'modes:', session.modes?.availableModes.map((m) => m.id).join(','), 'current:', session.modes?.currentModeId, `(${Date.now() - t0} ms)`)
  console.log('[config]', (session.configOptions ?? []).map((o) => `${o.id}=${o.type === 'select' ? o.currentValue : o.currentValue}`).join(' '))
  translator.beginTurn()
  const res = await conn.prompt({ sessionId, prompt: [{ type: 'text', text: 'Run `ls` in the working directory with the Bash tool, then reply with exactly one line: "pong: <number of entries>".' }] })
  const result = translator.finishTurn(res)
  console.log('[prompt done]', res.stopReason, JSON.stringify(res.usage), 'text:', result.resultText)
  const list = await conn.listSessions({ cwd })
  console.log('[list]', list.sessions.slice(0, 3).map((s) => `${s.sessionId.slice(0, 8)} ${s.title ?? ''}`).join(' | '))
  await proc.stop()
  if (!/pong/i.test(result.resultText ?? '')) {
    console.error('FAIL: unexpected reply')
    process.exit(1)
  }
  console.log('OK')
}

main().catch((err) => {
  console.error('FAIL', err)
  process.exit(1)
})
