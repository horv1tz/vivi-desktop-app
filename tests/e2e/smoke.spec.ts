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

test('sidebar: past sessions can be searched and renamed (AG-09)', async () => {
  // Starting a new chat archives the current one (from the earlier tests) into the sidebar list.
  await page.getByRole('button', { name: /Новый чат|New chat/ }).click()
  const sessionTitle = page.getByText('покажи файлы в папке').first()
  await expect(sessionTitle).toBeVisible({ timeout: 10_000 })

  const search = page.getByPlaceholder(/Поиск по сессиям|Search sessions/)
  await search.fill('does-not-exist-xyz')
  await expect(page.getByText(/Ничего не найдено|No sessions match/)).toBeVisible()
  await search.fill('')
  await expect(sessionTitle).toBeVisible()

  const row = page.locator('div.group', { hasText: 'покажи файлы в папке' }).first()
  await row.hover()
  await row.getByTitle(/Переименовать|Rename/).click()
  // The row's text content is gone once editing starts (it's now an <input> value, not text), so
  // `row` can no longer be re-resolved by its old hasText filter — look the input up globally by
  // its accessible name instead, which stays unique to whichever session is being edited.
  const input = page.getByRole('textbox', { name: /Переименовать|Rename/ })
  await input.fill('Renamed session')
  await input.press('Enter')
  await expect(page.getByText('Renamed session')).toBeVisible()
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

test('Permissions: compose a rule with a live preview, then remove it; decision log starts empty (SEC-03)', async () => {
  await page
    .getByRole('button', { name: /Настройки|Settings/ })
    .first()
    .click()
  await page.getByRole('button', { name: /^Разрешения$|^Permissions$/ }).click()

  await expect(page.getByText(/Правил пока нет|No rules yet/)).toBeVisible()
  // The mock backend never goes through PermissionBroker, so no decision has ever been logged.
  await expect(page.getByText(/Пока нет решений|No decisions recorded yet/)).toBeVisible()

  await page.getByRole('button', { name: /Добавить правило|Add rule/ }).click()
  await page.getByLabel(/Название инструмента|Tool name/).fill('TestTool')
  // getByLabel matches the <label>'s full text content, which (for a <select>) includes every
  // <option>'s text too — so these can't be anchored with ^...$ the way a plain Input label can.
  await page.getByLabel(/Область|Scope/).selectOption('path')
  await page.getByLabel(/Значение|Value/).fill('~/Vivi/**')
  await expect(page.getByText(/Это правило будет:|This rule will:/)).toBeVisible()
  await page.getByRole('button', { name: /^Сохранить$|^Save$/ }).click()

  await expect(page.getByText('TestTool(path:~/Vivi/**)')).toBeVisible()
  await expect(page.getByText(/Правил пока нет|No rules yet/)).not.toBeVisible()

  await page.getByTitle(/^Убрать$|^Remove$/).click()
  await expect(page.getByText(/Правил пока нет|No rules yet/)).toBeVisible()
})

test('Workshop: create, toggle and delete a skill, an integration and a scenario (INT-02, WORK-01/02)', async () => {
  await page
    .getByRole('button', { name: /Мастерская|Workshop/ })
    .first()
    .click()
  await expect(page.getByText(/Пока нет скилов|No skills yet/)).toBeVisible()

  await page.getByRole('button', { name: /Новый скил|New skill/ }).click()
  await page.getByLabel(/^Название$|^Name$/).fill('Commit style')
  await page.getByLabel(/^Описание$|^Description$/).fill('House style for git commits')
  await page.getByLabel(/Инструкции|Instructions/).fill('Use imperative mood.')
  await page.getByRole('button', { name: /Сохранить|Save/ }).click()

  const skillRow = page.getByTestId('skill-row').filter({ hasText: 'Commit style' })
  await expect(skillRow).toBeVisible()
  await expect(page.getByText('House style for git commits')).toBeVisible()

  const skillSwitch = skillRow.getByRole('switch')
  await expect(skillSwitch).toHaveAttribute('data-state', 'checked')
  await skillSwitch.click()
  await expect(skillSwitch).toHaveAttribute('data-state', 'unchecked')

  await skillRow.getByTitle(/Удалить|Delete/).click()
  await expect(page.getByText(/Пока нет скилов|No skills yet/)).toBeVisible()

  await page.getByRole('button', { name: /^Интеграции$|^Integrations$/ }).click()
  await expect(page.getByText(/не настроены|No integrations configured/)).toBeVisible()
  await expect(page.getByText(/Agent SDK-бэкендом|Agent SDK backend only/)).toBeVisible()

  await page.getByRole('button', { name: /Новая интеграция|New integration/ }).click()
  await page.getByLabel(/^Название$|^Name$/).fill('local-files')
  await page.getByLabel(/^Команда$|^Command$/).fill('npx')
  await page.getByLabel(/^Аргументы$|^Arguments$/).fill('-y @some/mcp-server')
  await page.getByRole('button', { name: /Сохранить|Save/ }).click()

  const integrationRow = page.getByTestId('integration-row').filter({ hasText: 'local-files' })
  await expect(integrationRow).toBeVisible()
  await expect(page.getByText('npx -y @some/mcp-server')).toBeVisible()

  await integrationRow.getByTitle(/Удалить|Delete/).click()
  await expect(page.getByText(/не настроены|No integrations configured/)).toBeVisible()

  await page.getByRole('button', { name: /^Сценарии$|^Scenarios$/ }).click()
  await expect(page.getByText(/Пока нет сценариев|No scenarios yet/)).toBeVisible()

  await page.getByRole('button', { name: /Новый сценарий|New scenario/ }).click()
  await page.getByLabel(/^Название$|^Name$/).fill('Play music')
  await page.getByLabel(/^Описание$|^Description$/).fill('Opens Spotify and starts playback')
  await page.getByRole('combobox').selectOption('wait')
  await page.getByPlaceholder(/Миллисекунды|Milliseconds/).fill('500')
  await page.getByRole('button', { name: /Сохранить|Save/ }).click()

  const scenarioRow = page.getByTestId('scenario-row').filter({ hasText: 'Play music' })
  await expect(scenarioRow).toBeVisible()
  await expect(page.getByText('Opens Spotify and starts playback')).toBeVisible()

  const scenarioSwitch = scenarioRow.getByRole('switch')
  await expect(scenarioSwitch).toHaveAttribute('data-state', 'checked')
  await scenarioSwitch.click()
  await expect(scenarioSwitch).toHaveAttribute('data-state', 'unchecked')

  await scenarioRow.getByTitle(/Удалить|Delete/).click()
  await expect(page.getByText(/Пока нет сценариев|No scenarios yet/)).toBeVisible()
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

test('WORK-04: the floating launcher button exists, shows by default, and toggles the overlay on click', async () => {
  const shown = await app.evaluate(async ({ BrowserWindow }) => {
    const launcher = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Vivi Quick Access')
    return launcher?.isVisible() ?? null
  })
  expect(shown).toBe(true)

  let launcherPage = app.windows().find((w) => w.url().includes('#launcher'))
  if (!launcherPage) {
    launcherPage = await app.waitForEvent('window', {
      predicate: (w) => w.url().includes('#launcher'),
    })
  }
  await launcherPage.waitForLoadState('domcontentloaded')

  const overlayVisibleBefore = await app.evaluate(async ({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('Overlay'))
    return overlay?.isVisible() ?? null
  })
  expect(overlayVisibleBefore).toBe(false)

  await launcherPage.getByRole('button', { name: 'Vivi' }).click()

  await expect(async () => {
    const overlayVisibleAfter = await app.evaluate(async ({ BrowserWindow }) => {
      const overlay = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('Overlay'))
      return overlay?.isVisible() ?? null
    })
    expect(overlayVisibleAfter).toBe(true)
  }).toPass({ timeout: 5_000 })

  // Leave things as this spec file's later tests expect: overlay hidden again.
  await launcherPage.getByRole('button', { name: 'Vivi' }).click()
  await expect(async () => {
    const overlayVisibleAfter = await app.evaluate(async ({ BrowserWindow }) => {
      const overlay = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('Overlay'))
      return overlay?.isVisible() ?? null
    })
    expect(overlayVisibleAfter).toBe(false)
  }).toPass({ timeout: 5_000 })
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
