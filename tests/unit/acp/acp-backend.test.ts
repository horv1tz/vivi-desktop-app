import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AcpBackend } from '@main/agent/acp-backend'
import { defaultSettings } from '@shared/settings'
import type { AgentUiEvent, PermissionRequest } from '@shared/events'

// Drives AcpBackend against tests/unit/acp/fixtures/fake-agent.mjs (a real ACP agent process over stdio).
const FIXTURE = resolve('tests/unit/acp/fixtures/fake-agent.mjs')
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }

function makeBackend(mode = 'normal') {
  const dir = mkdtempSync(join(tmpdir(), 'vivi-acp-unit-'))
  const settings = defaultSettings()
  settings.agent.backend = 'acp'
  settings.agent.acpCommand = process.execPath
  settings.agent.acpArgs = FIXTURE
  settings.agent.workspaceDir = dir
  settings.agent.continueLastSession = false
  settings.agent.permissionMode = 'acceptEdits'
  const events: AgentUiEvent[] = []
  const permissionRequests: PermissionRequest[] = []
  const updates: { permissions: { alwaysAllowRules: { toolName: string; ruleContent?: string }[] } }[] = []
  const backend = new AcpBackend({
    getSettings: () => settings,
    updateSettings: (patch) => {
      updates.push(patch)
      settings.permissions.alwaysAllowRules = patch.permissions.alwaysAllowRules
    },
    getExtraEnv: async () => ({ FAKE_AGENT_MODE: mode, ANTHROPIC_API_KEY: 'should-not-reach-third-party-agents' }),
    isolateConfig: () => true,
    cwd: () => dir,
    homeDir: dir,
    memoryFile: () => join(dir, 'VIVI.md'),
    claudeConfigDir: join(dir, 'claude'),
    adapterEntry: () => null,
    adapterBootstrap: () => null,
    createMcpServer: () => new McpServer({ name: 'vivi', version: '0.0.0' }),
    ui: { requestPermission: (r) => permissionRequests.push(r), resolvePermission: () => undefined, requestQuestion: () => undefined, resolveQuestion: () => undefined },
    appVersion: '0.0.0-test',
    titlesFile: join(dir, 'titles.json'),
    log: silent,
    initTimeoutMs: 20_000,
  })
  backend.onEvent((e) => events.push(e))
  return { backend, events, permissionRequests, updates, settings }
}

async function until(pred: () => boolean, ms = 20_000): Promise<void> {
  const started = Date.now()
  while (!pred()) {
    if (Date.now() - started > ms) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 15))
  }
}

const textOf = (events: AgentUiEvent[]): string =>
  events
    .filter((e): e is Extract<AgentUiEvent, { type: 'assistant-message' }> => e.type === 'assistant-message')
    .flatMap((e) => e.message.blocks)
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')

describe('AcpBackend against a real ACP agent process', () => {
  it('runs a prompt: permission dialog → allow → tool result → final text → result, then idle', async () => {
    const { backend, events, permissionRequests } = makeBackend()
    await backend.start()
    await backend.send({ text: 'hello' })
    await until(() => permissionRequests.length === 1)
    const req = permissionRequests[0]!
    expect(req).toMatchObject({ toolName: 'Bash', category: 'exec', canAlwaysAllow: true, input: { command: 'git status' } })
    expect(backend.getState().state).toBe('awaiting_permission')
    backend.broker.respond(req.requestId, 'allow')
    await until(() => events.some((e) => e.type === 'result'))
    const toolResult = events.find((e): e is Extract<AgentUiEvent, { type: 'tool-result' }> => e.type === 'tool-result')!
    expect(toolResult.result).toMatchObject({ content: 'permission:allow-once', isError: false })
    expect(textOf(events)).toContain('done (allow-once) in mode acceptEdits with 1 MCP server(s)')
    const result = events.find((e): e is Extract<AgentUiEvent, { type: 'result' }> => e.type === 'result')!
    expect(result.result).toMatchObject({ subtype: 'success', inputTokens: 1, outputTokens: 2 })
    expect(backend.getState()).toMatchObject({ state: 'idle', model: 'fake-1' })
    expect(await backend.listModels()).toEqual([
      { id: 'fake-1', name: 'Fake 1', description: undefined },
      { id: 'fake-2', name: 'Fake 2', description: undefined },
    ])
    expect((await backend.listSessions()).map((s) => s.sessionId)).toEqual(['sess-1'])
    await backend.dispose()
    await expect(backend.send({ text: 'again' })).rejects.toThrow(/disposed/)
  }, 40_000)

  it('"always allow" picks the agent\'s persistent option and stores a scoped rule', async () => {
    const { backend, events, permissionRequests, updates } = makeBackend()
    await backend.send({ text: 'hello' })
    await until(() => permissionRequests.length === 1)
    backend.broker.respond(permissionRequests[0]!.requestId, 'allow-always')
    await until(() => events.some((e) => e.type === 'result'))
    expect(events.find((e): e is Extract<AgentUiEvent, { type: 'tool-result' }> => e.type === 'tool-result')!.result.content).toBe('permission:allow-with-updates')
    expect(updates.at(-1)?.permissions.alwaysAllowRules).toEqual([{ toolName: 'Bash', ruleContent: 'git:*' }])
    // The rule now auto-allows the same call without a dialog.
    events.length = 0
    await backend.send({ text: 'hello again' })
    await until(() => events.some((e) => e.type === 'result'))
    expect(permissionRequests).toHaveLength(1)
    expect(textOf(events)).toContain('done (allow-once)')
    await backend.dispose()
  }, 40_000)

  it('deny selects the reject option and marks the tool as failed', async () => {
    const { backend, events, permissionRequests } = makeBackend()
    await backend.send({ text: 'hello' })
    await until(() => permissionRequests.length === 1)
    backend.broker.respond(permissionRequests[0]!.requestId, 'deny')
    await until(() => events.some((e) => e.type === 'result'))
    expect(events.find((e): e is Extract<AgentUiEvent, { type: 'tool-result' }> => e.type === 'tool-result')!.result).toMatchObject({ content: 'permission:reject', isError: true })
    await backend.dispose()
  }, 40_000)

  it('interrupt cancels the running turn (session/cancel) and reports a cancelled result', async () => {
    const { backend, events } = makeBackend()
    await backend.send({ text: 'please hang' })
    await until(() => events.some((e) => e.type === 'text-delta'))
    await backend.interrupt()
    await until(() => events.some((e) => e.type === 'result'))
    expect(events.find((e): e is Extract<AgentUiEvent, { type: 'result' }> => e.type === 'result')!.result.subtype).toBe('cancelled')
    expect(events.filter((e) => e.type === 'error')).toEqual([])
    expect(backend.getState().state).toBe('idle')
    await backend.dispose()
  }, 40_000)

  it('an agent crash mid-turn is reported exactly once as process_exited', async () => {
    const { backend, events } = makeBackend('crash')
    await backend.send({ text: 'hello' })
    await until(() => events.some((e) => e.type === 'error'))
    await until(() => events.some((e) => e.type === 'result'))
    const errors = events.filter((e): e is Extract<AgentUiEvent, { type: 'error' }> => e.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.error.code).toBe('process_exited')
    expect(backend.getState().state).toBe('failed')
    await backend.dispose()
  }, 40_000)

  it('a restart while a turn is running cancels it without an error and the next send works', async () => {
    const { backend, events } = makeBackend()
    await backend.send({ text: 'please hang' })
    await until(() => events.some((e) => e.type === 'text-delta'))
    await backend.restart()
    await until(() => events.some((e) => e.type === 'result'))
    expect(events.find((e): e is Extract<AgentUiEvent, { type: 'result' }> => e.type === 'result')!.result.subtype).toBe('cancelled')
    expect(events.filter((e) => e.type === 'error')).toEqual([])
    events.length = 0
    const { permissionRequests } = { permissionRequests: [] as PermissionRequest[] }
    void permissionRequests
    await backend.send({ text: 'after restart' })
    await until(() => events.some((e) => e.type === 'text-delta'))
    expect(backend.getState().state).toBe('awaiting_permission')
    await backend.dispose()
  }, 40_000)
})
