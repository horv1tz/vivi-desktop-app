import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mainWindow } from './helpers'

// Runs the real run_scenario/list_scenarios tools end to end against the machine's existing
// Claude Code login. Opt in with VIVI_E2E_REAL=1 (spends a few cents of API/subscription usage).
test.skip(
  process.env.VIVI_E2E_REAL !== '1',
  'set VIVI_E2E_REAL=1 to run against the real Claude backend',
)

let app: ElectronApplication
let page: Page
let userData: string
let workspace: string

const SEEDED_SCENARIO = {
  id: 'seed-1',
  name: 'Ping test',
  description: 'A harmless scenario used only to verify run_scenario gets called end to end.',
  triggerPhrases: ['ping test', 'run the ping test scenario'],
  steps: [{ kind: 'notify', title: 'pinged', body: 'ok' }],
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
}

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'vivi-real-scenarios-'))
  mkdirSync(join(userData, 'vivi'), { recursive: true })
  workspace = mkdtempSync(join(tmpdir(), 'vivi-ws-scenarios-'))
  const scenariosDir = join(workspace, 'scenarios')
  mkdirSync(scenariosDir, { recursive: true })
  writeFileSync(join(scenariosDir, 'scenarios.json'), JSON.stringify([SEEDED_SCENARIO]), 'utf8')
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      onboardingCompleted: true,
      auth: { mode: 'existing-claude' },
      agent: {
        workspaceDir: workspace,
        maxTurns: 6,
        maxBudgetUsd: 0.5,
        continueLastSession: false,
      },
      // run_scenario is categorized 'input' (same tier as keyboard) — disable the prompt so the
      // agent can run it without a permission dialog blocking this single-turn test.
      permissions: { askForInput: false },
    }),
  )
  app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production', VIVI_MOCK_AGENT: '' },
    timeout: 60_000,
  })
  page = await mainWindow(app)
})

test.afterAll(async () => {
  await app?.close()
})

test('real Claude finds and calls run_scenario for a request matching an existing scenario', async () => {
  test.setTimeout(180_000)
  const composer = page.getByPlaceholder(/команду|command/i)
  await composer.fill(
    'Запусти сценарий "ping test", пожалуйста. Не спрашивай подтверждения, просто выполни его через run_scenario.',
  )
  await composer.press('Enter')
  await expect(page.getByText(/Стоимость|Cost/)).toBeVisible({ timeout: 90_000 })

  // The journal (AG-02) is the app's own audit trail of every tool call — reading it, rather than
  // trusting the chat reply text, is the only way to prove the real model actually invoked the
  // tool (not just claimed to in prose).
  const journalFile = join(userData, 'journal', 'journal.json')
  await expect(() => expect(existsSync(journalFile)).toBe(true)).toPass({ timeout: 15_000 })
  const entries: { name: string; input: string }[] = JSON.parse(readFileSync(journalFile, 'utf8'))
  const call = entries.find((e) => e.name === 'mcp__vivi__run_scenario')
  expect(call).toBeDefined()
  expect(call!.input.toLowerCase()).toContain('ping test')
})
