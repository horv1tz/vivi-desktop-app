import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mainWindow } from './helpers'

// Same scenario as real-agent.spec.ts but through the ACP backend (bundled claude-agent-acp adapter):
// the vivi tools reach the agent over the local MCP endpoint and permissions flow through session/request_permission.
// Opt in with VIVI_E2E_REAL=1; VIVI_E2E_EXECUTABLE=<packaged binary> runs it against a packaged build.
test.skip(process.env.VIVI_E2E_REAL !== '1', 'set VIVI_E2E_REAL=1 to run against the real Claude backend')

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'vivi-acp-'))
  mkdirSync(join(userData, 'vivi'), { recursive: true })
  const workspace = mkdtempSync(join(tmpdir(), 'vivi-ws-'))
  writeFileSync(join(workspace, 'todo.txt'), 'buy milk\nwrite report\n')
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      onboardingCompleted: true,
      auth: { mode: 'existing-claude' },
      agent: { backend: 'acp', workspaceDir: workspace, maxTurns: 6, maxBudgetUsd: 0.5, continueLastSession: false },
      permissions: { askForExec: false },
    }),
  )
  const executablePath = process.env.VIVI_E2E_EXECUTABLE
  app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ['.']), '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production', VIVI_MOCK_AGENT: '' },
    timeout: 60_000,
  })
  page = await mainWindow(app)
})

test.afterAll(async () => {
  await app?.close()
})

test('ACP backend: real Claude uses the vivi screenshot tool over MCP and reads a file', async () => {
  test.setTimeout(240_000)
  const composer = page.getByPlaceholder(/команду|command/i)
  await expect(composer).toBeVisible({ timeout: 30_000 })
  await composer.fill('Сделай скриншот экрана и скажи одной фразой, что на нём. Потом прочитай файл todo.txt в рабочей папке и перечисли пункты.')
  await composer.press('Enter')
  await expect(page.getByText(/Делаю скриншот|Taking screenshot/)).toBeVisible({ timeout: 120_000 })
  // The model may read the file with Read or with a shell command; both are tool cards.
  await expect(page.getByText(/Читаю файл|Reading file|Выполняю команду|Running command/).first()).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/milk|молок/i).last()).toBeVisible({ timeout: 120_000 })
  // The turn result line (cost/tokens) appears once session/prompt resolves.
  await expect(page.getByText(/Стоимость|Cost/)).toBeVisible({ timeout: 60_000 })
})
