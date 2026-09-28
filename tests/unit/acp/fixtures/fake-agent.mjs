// Minimal ACP agent used to exercise AcpBackend end to end without Claude.
// Speaks ndjson JSON-RPC over stdio like any real agent. Behaviour switches via FAKE_AGENT_MODE:
//   normal (default) — one text chunk, one Bash tool call gated by session/request_permission, final text
//   crash            — exits with code 3 right after the first chunk
//   auth             — initialize() reports one non-terminal auth method (ACP-02)
// A prompt containing "hang" waits until session/cancel OR a `_session/steering` call arrives; a
// steer resumes it immediately with a chunk naming what was steered in, instead of waiting for cancel.
import { appendFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'

const mode = process.env.FAKE_AGENT_MODE ?? 'normal'
const sessions = new Map()
let client
let onSteer = null

const PERMISSION_OPTIONS = [
  { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
  {
    optionId: 'allow-with-updates',
    name: "Yes, and don't ask again for git commands",
    kind: 'allow_always',
  },
  { optionId: 'reject', name: 'No', kind: 'reject_once' },
]

const agent = {
  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: 'fake-agent', version: '1.0.0' },
      agentCapabilities: { loadSession: false, sessionCapabilities: { list: {} } },
      authMethods:
        mode === 'auth'
          ? [
              { id: 'fake-login', name: 'Fake login', description: 'Sign in via fake-agent' },
              { id: 'fake-terminal', type: 'terminal', name: 'Fake terminal login' },
            ]
          : [],
      // ACP-03: advertises the `_session/steering` extension the same way claude-agent-acp does.
      _meta: { steering: { supported: true } },
    }
  },
  async newSession(params) {
    const sessionId = `sess-${sessions.size + 1}`
    sessions.set(sessionId, {
      cwd: params.cwd,
      mcpServers: params.mcpServers ?? [],
      cancelled: false,
      mode: 'default',
      model: 'fake-1',
    })
    return {
      sessionId,
      modes: {
        currentModeId: 'default',
        availableModes: [
          { id: 'default', name: 'Default' },
          { id: 'acceptEdits', name: 'Accept edits' },
        ],
      },
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          type: 'select',
          currentValue: 'fake-1',
          options: [
            { value: 'fake-1', name: 'Fake 1' },
            { value: 'fake-2', name: 'Fake 2' },
          ],
        },
      ],
    }
  },
  async listSessions() {
    return {
      sessions: [...sessions].map(([sessionId, s]) => ({
        sessionId,
        cwd: s.cwd,
        title: 'fake session',
        updatedAt: new Date().toISOString(),
      })),
    }
  },
  async setSessionMode(params) {
    const s = sessions.get(params.sessionId)
    if (s) s.mode = params.modeId
    return {}
  },
  async setSessionConfigOption(params) {
    const s = sessions.get(params.sessionId)
    if (s && params.configId === 'model') s.model = params.value
    return {
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          type: 'select',
          currentValue: s?.model ?? 'fake-1',
          options: [
            { value: 'fake-1', name: 'Fake 1' },
            { value: 'fake-2', name: 'Fake 2' },
          ],
        },
      ],
    }
  },
  async authenticate(params) {
    if (process.env.FAKE_AGENT_AUTH_LOG)
      appendFileSync(process.env.FAKE_AGENT_AUTH_LOG, `${params.methodId}\n`)
    return {}
  },
  async extMethod(method, params) {
    if (method !== '_session/steering') throw new Error(`unknown ext method ${method}`)
    if (!onSteer) return { outcome: 'startedNewTurn' }
    const steer = onSteer
    onSteer = null
    steer(params)
    return { outcome: 'injected' }
  },
  async cancel(params) {
    const s = sessions.get(params.sessionId)
    if (s) s.cancelled = true
  },
  async prompt(params) {
    const { sessionId } = params
    const s = sessions.get(sessionId)
    s.cancelled = false
    const text = params.prompt.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const update = (u) => client.sessionUpdate({ sessionId, update: u })
    await update({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `Working on "${text}"… ` },
    })
    await update({
      sessionUpdate: 'plan',
      entries: [{ content: 'Look into it', priority: 'medium', status: 'in_progress' }],
    })
    await update({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'research', description: 'Research something' }],
    })
    await update({ sessionUpdate: 'notice', severity: 'info', title: 'fake notice' })
    if (mode === 'crash') process.exit(3)
    if (text.includes('hang')) {
      const steered = await new Promise((resolve) => {
        onSteer = resolve
        const t = setInterval(() => {
          if (s.cancelled) {
            clearInterval(t)
            onSteer = null
            resolve(null)
          }
        }, 10)
      })
      if (steered) {
        const steeredText = steered.prompt.map((b) => (b.type === 'text' ? b.text : '')).join('')
        await update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `steered: "${steeredText}"` },
        })
        return {
          stopReason: 'end_turn',
          usage: { totalTokens: 1, inputTokens: 1, outputTokens: 0 },
        }
      }
      return { stopReason: 'cancelled' }
    }
    const toolCall = {
      toolCallId: 'tc-1',
      title: 'Run git status',
      rawInput: { command: 'git status' },
      _meta: { claudeCode: { toolName: 'Bash' } },
    }
    await update({ sessionUpdate: 'tool_call', ...toolCall, kind: 'execute', status: 'pending' })
    const perm = await client.requestPermission({
      sessionId,
      toolCall,
      options: PERMISSION_OPTIONS,
    })
    const chosen = perm.outcome.outcome === 'selected' ? perm.outcome.optionId : 'cancelled'
    const ok = chosen === 'allow-once' || chosen === 'allow-with-updates'
    await update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: ok ? 'completed' : 'failed',
      content: [{ type: 'content', content: { type: 'text', text: `permission:${chosen}` } }],
    })
    await update({
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: `done (${chosen}) in mode ${s.mode} with ${s.mcpServers.length} MCP server(s), model ${s.model}`,
      },
    })
    return {
      stopReason: s.cancelled ? 'cancelled' : 'end_turn',
      usage: { totalTokens: 3, inputTokens: 1, outputTokens: 2 },
    }
  },
}

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
new AgentSideConnection((c) => {
  client = c
  return agent
}, stream)
