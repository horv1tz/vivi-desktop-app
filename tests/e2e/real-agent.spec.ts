import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mainWindow } from './helpers'

// Runs the packaged-in Claude Agent SDK end to end using the machine's existing Claude Code login.
// Opt in with VIVI_E2E_REAL=1 (spends a few cents of API/subscription usage).
test.skip(process.env.VIVI_E2E_REAL !== '1', 'set VIVI_E2E_REAL=1 to run against the real Claude backend')

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'vivi-real-'))
  mkdirSync(join(userData, 'vivi'), { recursive: true })
  const workspace = mkdtempSync(join(tmpdir(), 'vivi-ws-'))
  writeFileSync(join(workspace, 'todo.txt'), 'buy milk\nwrite report\n')
  // Reuse the developer's Claude Code login (auth mode "existing-claude" → no CLAUDE_CONFIG_DIR override).
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ onboardingCompleted: true, auth: { mode: 'existing-claude' }, agent: { workspaceDir: workspace, maxTurns: 6, maxBudgetUsd: 0.5, continueLastSession: false }, permissions: { askForExec: false } }),
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

test('real Claude answers, uses the vivi screenshot tool and reads a file', async () => {
  test.setTimeout(180_000)
  const composer = page.getByPlaceholder(/команду|command/i)
  await composer.fill('Сделай скриншот экрана и скажи одной фразой, что на нём. Потом прочитай файл todo.txt в рабочей папке и перечисли пункты.')
  await composer.press('Enter')
  await expect(page.getByText(/Делаю скриншот|Taking screenshot/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText(/Читаю файл|Reading file/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText(/milk|молок/i).last()).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText(/Стоимость|Cost/)).toBeVisible({ timeout: 60_000 })
  const state = await page.evaluate(() => (window as unknown as { vivi: { invoke: (c: string) => Promise<{ state: string; totalCostUsd: number }> } }).vivi.invoke('agent:getState'))
  expect(state.state).toBe('idle')
  expect(state.totalCostUsd).toBeGreaterThan(0)
})
