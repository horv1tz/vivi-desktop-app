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

// Runs the real manage_skill tool end to end against the machine's existing Claude Code login.
// Opt in with VIVI_E2E_REAL=1 (spends a few cents of API/subscription usage).
test.skip(
  process.env.VIVI_E2E_REAL !== '1',
  'set VIVI_E2E_REAL=1 to run against the real Claude backend',
)

let app: ElectronApplication
let page: Page
let workspace: string

test.beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'vivi-real-skills-'))
  mkdirSync(join(userData, 'vivi'), { recursive: true })
  workspace = mkdtempSync(join(tmpdir(), 'vivi-ws-skills-'))
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
      // manage_skill is categorized 'edit' — disable the prompt so the agent can save the skill
      // without a permission dialog blocking this single-turn test.
      permissions: { askForExec: false, askForEdits: false },
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

test('real Claude uses manage_skill to save a skill when asked to remember a procedure', async () => {
  test.setTimeout(180_000)
  const composer = page.getByPlaceholder(/команду|command/i)
  await composer.fill(
    'Запомни это как скил с названием ровно "Commit style test": в сообщениях коммитов всегда используй повелительное наклонение. Не спрашивай подтверждения, просто сохрани.',
  )
  await composer.press('Enter')
  await expect(page.getByText(/Стоимость|Cost/)).toBeVisible({ timeout: 90_000 })

  const skillsFile = join(workspace, 'skills', 'skills.json')
  await expect(() => expect(existsSync(skillsFile)).toBe(true)).toPass({ timeout: 15_000 })
  const saved: { name: string; body: string; source: string; enabled: boolean }[] = JSON.parse(
    readFileSync(skillsFile, 'utf8'),
  )
  expect(saved.length).toBeGreaterThan(0)
  const skill = saved.find((s) => s.name.toLowerCase().includes('commit style test'))
  expect(skill).toBeDefined()
  expect(skill!.source).toBe('agent')
  expect(skill!.enabled).toBe(true)
  expect(skill!.body.toLowerCase()).toMatch(/imperative|повелительн/)
})
