import { mkdtempSync, writeFileSync } from 'node:fs'
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

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'vivi-e2e-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ onboardingCompleted: true }))
  app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, VIVI_MOCK_AGENT: '1', NODE_ENV: 'production' },
    timeout: 60_000,
  })
  page = await mainWindow(app)
})

test.afterAll(async () => {
  await app?.close()
})

test('main window renders the chat shell', async () => {
  await expect(page).toHaveTitle(/Vivi/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByPlaceholder(/команду|command/i)).toBeVisible()
})

test('mock agent streams a reply with a tool card', async () => {
  const composer = page.getByPlaceholder(/команду|command/i)
  await composer.fill('покажи файлы в папке')
  await composer.press('Enter')
  await expect(page.getByText('покажи файлы в папке')).toBeVisible()
  await expect(page.getByText(/ls -la ~\/Vivi/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/notes\.md|Что с ними сделать/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Стоимость|Cost/)).toBeVisible()
})

test('a retryable error shows a Retry button that resends the same message', async () => {
  const composer = page.getByPlaceholder(/команду|command/i)
  await composer.fill('симулируй ошибку')
  await composer.press('Enter')
  await expect(page.getByText(/перегружен|overloaded/i)).toBeVisible({ timeout: 10_000 })
  const retryButton = page.getByRole('button', { name: /^Повторить$|^Retry$/ })
  await expect(retryButton).toBeVisible()
  await retryButton.click()
  // The retry resends the exact same text, which the mock backend treats as another error.
  await expect(page.getByText(/перегружен|overloaded/i)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Закрыть|Close/ }).click()
})

test('journal records the mock agent tool call', async () => {
  await page.getByRole('button', { name: /Активность|Activity/ }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(/сделала Vivi|Vivi did/)
  await expect(page.getByText('Bash')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/ls -la ~\/Vivi/)).toBeVisible()
  await page.getByRole('button', { name: /Чат|Chat/ }).click()
})

test('settings view opens and switches sections', async () => {
  await page
    .getByRole('button', { name: /Настройки|Settings/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(/Общие|General/)
  await page.getByRole('button', { name: /О программе|About/ }).click()
  await expect(page.getByText(/Claude Agent SDK/)).toBeVisible()
  await expect(page.getByText(/0\.3\.283/)).toBeVisible()
  await page.getByRole('button', { name: /^Память$|^Memory$/ }).click()
  await expect(page.getByText(/Пока ничего не запомнено|Nothing remembered yet/)).toBeVisible()
  // OBS-02: the earlier mock exchange should already have recorded a turn's cost/tokens.
  await page.getByRole('button', { name: /^Расход$|^Usage$/ }).click()
  await expect(page.getByText(/Всего потрачено|Total cost/)).toBeVisible()
  await expect(page.getByText(/^\$0\.00$/)).not.toBeVisible()
  // OBS-01: the live Diagnostics panel reports whichever input driver actually resolved in this
  // environment (varies by sandbox — just check it rendered a real answer, not the loading state).
  await page.getByRole('button', { name: /^Диагностика$|^Diagnostics$/ }).click()
  await expect(page.getByText(/Драйвер ввода|Input driver/)).toBeVisible()
  await expect(
    page.getByText(/Активен:|Active:|Драйвер недоступен|No driver available/),
  ).toBeVisible({ timeout: 10_000 })
})

test('overlay window exists and can be toggled via IPC', async () => {
  const windows = app.windows()
  expect(windows.length).toBeGreaterThanOrEqual(2)
  const visible = await app.evaluate(async ({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('Overlay'))
    return overlay?.isVisible() ?? null
  })
  expect(visible).toBe(false)
})

test('fresh profile starts with onboarding', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'vivi-e2e-fresh-'))
  const fresh = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, VIVI_MOCK_AGENT: '1' },
    timeout: 60_000,
  })
  try {
    const win = await mainWindow(fresh)
    await expect(win.getByRole('heading', { level: 1 })).toHaveText(/Виви|Vivi/, {
      timeout: 15_000,
    })
    await win.getByRole('button', { name: /Далее|Next/ }).click()
    await expect(win.getByRole('heading', { level: 2 })).toHaveText(/Claude/)
    await expect(
      win.getByRole('button', { name: /Войти через Claude|Sign in with Claude/ }),
    ).toBeVisible()

    // UX-06: can't finish onboarding unauthenticated without explicitly acknowledging the warning.
    await win.getByRole('button', { name: /^Пропустить$|^Skip$/ }).click()
    await win.getByRole('button', { name: /Далее|Next/ }).click()
    await win.getByRole('button', { name: /Далее|Next/ }).click()
    const startButton = win.getByRole('button', { name: /^Начать$|^Start$/ })
    await expect(
      win.getByText(/рабочего подключения к Claude|working connection to Claude/),
    ).toBeVisible()
    await expect(startButton).toBeDisabled()
    await win.getByRole('checkbox').check()
    await expect(startButton).toBeEnabled()
    await startButton.click()
    await expect(win.getByPlaceholder(/команду|command/i)).toBeVisible()
  } finally {
    await fresh.close()
  }
})
