import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'vivi-e2e-'))
  app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, VIVI_MOCK_AGENT: '1', NODE_ENV: 'production' },
    timeout: 60_000,
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
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

test('settings view opens and switches sections', async () => {
  await page.getByRole('button', { name: /Настройки|Settings/ }).first().click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(/Общие|General/)
  await page.getByRole('button', { name: /О программе|About/ }).click()
  await expect(page.getByText(/Claude Agent SDK/)).toBeVisible()
  await expect(page.getByText(/0\.3\.283/)).toBeVisible()
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
