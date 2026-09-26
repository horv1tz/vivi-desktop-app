/* Runs AgentSession against the real Claude Code binary in plain Node (no Electron).
   Usage: CLAUDE_CONFIG_DIR=$HOME/.claude npx tsx scripts/smoke-agent.ts "your prompt"
   Env: VIVI_CLAUDE_BIN=/path/to/claude to reuse an installed CLI; VIVI_SMOKE_BUDGET (USD, default 0.25). */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { AgentSession } from '../src/main/agent/session'
import { buildOptions } from '../src/main/agent/options'
import { defaultSettings } from '../src/shared/settings'
import { autoAllowedTools } from '../src/main/agent/permissions/policy'

const prompt = process.argv.slice(2).join(' ') || 'Скажи, какой сегодня день недели, и перечисли файлы в рабочей папке одной строкой.'
const cwd = mkdtempSync(join(tmpdir(), 'vivi-smoke-'))
writeFileSync(join(cwd, 'hello.txt'), 'hello from vivi smoke test\n')
const settings = defaultSettings()
settings.agent.maxTurns = 6
settings.agent.maxBudgetUsd = Number(process.env.VIVI_SMOKE_BUDGET ?? '0.25')

const options = buildOptions({
  settings,
  cwd,
  homeDir: homedir(),
  memoryFile: join(cwd, 'VIVI.md'),
  claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
  extraEnv: {},
  claudeBinary: process.env.VIVI_CLAUDE_BIN,
  appVersion: 'smoke',
  allowedTools: autoAllowedTools(settings.permissions),
  alwaysAllowRules: [],
  isolateConfig: false,
  canUseTool: async (toolName, input) => {
    console.log(`\n[permission] auto-allow ${toolName} ${JSON.stringify(input).slice(0, 120)}`)
    return { behavior: 'allow', updatedInput: input }
  },
})

let deltas = 0
let toolUses = 0
let result: unknown = null
const session = new AgentSession({
  options,
  queryFn: query,
  emit: (e) => {
    switch (e.type) {
      case 'session':
        console.log(`[session] id=${e.sessionId} model=${e.model} tools=${e.tools?.length}`)
        break
      case 'text-delta':
        deltas++
        process.stdout.write(e.text)
        break
      case 'tool-use':
        toolUses++
        console.log(`\n[tool-use] ${e.block.name} ${JSON.stringify(e.block.input).slice(0, 120)}`)
        break
      case 'tool-result':
        console.log(`[tool-result] ${e.result.isError ? 'ERROR ' : ''}${e.result.content.slice(0, 200).replace(/\n/g, ' ')}`)
        break
      case 'result':
        result = e.result
        console.log(`\n[result] ${e.result.subtype} cost=$${e.result.costUsd.toFixed(4)} total=$${e.result.totalCostUsd.toFixed(4)} in=${e.result.inputTokens} out=${e.result.outputTokens} ${e.result.durationMs}ms`)
        break
      case 'error':
        console.log(`\n[error] ${e.error.code}: ${e.error.message}`)
        break
      case 'state':
        console.log(`[state] ${e.state}`)
        break
      case 'rate-limit':
        console.log(`[rate-limit] ${JSON.stringify(e.info)}`)
        break
      default:
        break
    }
  },
  log: console,
})

const started = Date.now()
await session.start()
console.log(`[smoke] init ok in ${Date.now() - started}ms; sending prompt…`)
await session.send({ text: prompt })
await new Promise<void>((resolve) => {
  const t = setInterval(() => {
    if (result || !session.isAlive) {
      clearInterval(t)
      resolve()
    }
  }, 200)
})
await session.dispose()
console.log(`[smoke] done: deltas=${deltas} toolUses=${toolUses} alive=${session.isAlive}`)
process.exit(result ? 0 : 1)
