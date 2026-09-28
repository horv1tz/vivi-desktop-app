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
  page.on('console', (msg) => console.log('[DEBUG console]', msg.type(), msg.text()))
  page.on('pageerror', (err) => console.log('[DEBUG pageerror]', err.message, err.stack))
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
  // Scoped to the error banner's role="alert" region — an unscoped name match on "Закрыть"/"Close"
  // now also matches the title bar's (correctly, separately labelled) window-close button.
  await page
    .getByRole('alert')
    .getByRole('button', { name: /Закрыть|Close/ })
    .click()
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

  // VO-12: the STT/TTS dropdowns are now derived from the shared model registry instead of a
  // hardcoded, easily-stale duplicate list — check a model only present in the registry renders.
  await page.getByRole('button', { name: /^Голос$|^Voice$/ }).click()
  await expect(page.getByLabel(/Распознавание речи|Speech recognition/)).toBeVisible()
  await expect(
    page.getByLabel(/Распознавание речи|Speech recognition/).getByRole('option', {
      name: /Whisper tiny/,
    }),
  ).toHaveCount(1)

  // Cloud providers: selecting OpenAI reveals its own voice/model pickers (previously the voice
  // picker existed in settings but had no UI at all, and the STT provider had no effect either).
  await page.getByLabel(/Разрешить облачные провайдеры|Allow cloud providers/).click()
  // Unanchored: a <select>'s computed accessible name (via its wrapping <label>) includes its
  // own rendered option text too, not just the label's own text — same pitfall as the command
  // palette's dropdowns (see UX-05/07 history), so `^...$` doesn't match here.
  await page.getByLabel(/Провайдер распознавания|Recognition provider/).selectOption('openai')
  await expect(page.getByLabel(/Модель распознавания OpenAI|OpenAI recognition model/)).toHaveValue(
    'gpt-4o-mini-transcribe',
  )
  await page.getByLabel(/Провайдер синтеза|Synthesis provider/).selectOption('openai')
  await expect(page.getByLabel(/Голос OpenAI|OpenAI voice/)).toHaveValue('alloy')
  await expect(page.getByLabel(/Модель синтеза OpenAI|OpenAI synthesis model/)).toHaveValue(
    'gpt-4o-mini-tts',
  )
})

test('ACP-02: picking an agent preset fills the command and arguments fields', async () => {
  await page.getByRole('button', { name: /^Агент$|^Agent$/ }).click()
  const backendField = page.getByLabel(/talks to Claude|Способ подключения к Claude/)
  await backendField.selectOption('acp')
  const commandField = page.getByLabel(/Команда ACP-агента|ACP agent command/)
  const argsField = page.getByLabel(/аргументы|arguments/i)
  await expect(commandField).toHaveValue('')

  await page.getByLabel(/Известные агенты|Known agents/).selectOption('gemini-cli')
  await expect(commandField).toHaveValue('gemini')
  await expect(argsField).toHaveValue('--acp')

  await page.getByLabel(/Известные агенты|Known agents/).selectOption('codex-acp')
  await expect(commandField).toHaveValue('npx')
  await expect(argsField).toHaveValue('-y @agentclientprotocol/codex-acp')

  // Back to the bundled adapter, and off ACP entirely, so later tests see the mock agent as usual.
  await page.getByLabel(/Известные агенты|Known agents/).selectOption('claude')
  await expect(commandField).toHaveValue('')
  await backendField.selectOption('sdk')
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

  // The skill library picker (a ready-made preset) prefills the form; still editable before save.
  await page.getByRole('button', { name: /Новый скил|New skill/ }).click()
  await page.getByLabel(/Библиотека|Library/).selectOption('code-review-checklist')
  await expect(page.getByLabel(/^Название$|^Name$/)).toHaveValue('Code review checklist')
  await expect(page.getByLabel(/Инструкции|Instructions/)).not.toHaveValue('')
  await page.getByLabel(/^Описание$|^Description$/).fill('House style for git commits')
  await page.getByRole('button', { name: /Сохранить|Save/ }).click()

  const skillRow = page.getByTestId('skill-row').filter({ hasText: 'Code review checklist' })
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

  // The MCP library picker (a verified real server) prefills command/args and declares the env
  // var it needs; INT-01's env var row then round-trips a value through the real, running main
  // process's encrypted secret store (not mocked in this e2e suite).
  await page.getByRole('button', { name: /Новая интеграция|New integration/ }).click()
  await page.getByLabel(/Известный MCP-сервер|Known MCP server/).selectOption('github')
  await expect(page.getByLabel(/^Название$|^Name$/)).toHaveValue('GitHub (official)')
  await expect(page.getByLabel(/^Команда$|^Command$/)).toHaveValue('docker')
  await expect(page.getByLabel(/^Аргументы$|^Arguments$/)).toHaveValue(
    'run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server',
  )

  const envRow = page.getByTestId('env-var-row').filter({ hasText: 'GITHUB_PERSONAL_ACCESS_TOKEN' })
  await expect(envRow).toBeVisible()
  await envRow.getByPlaceholder(/Значение|Value/).fill('ghp_test_token_123')
  await envRow.getByRole('button', { name: /Сохранить|Save/ }).click()
  await expect(envRow.getByPlaceholder(/сохранено|saved/)).toBeVisible()

  // .last(): the env var row above has its own "Save" button; this is the outer form's.
  await page.getByRole('button', { name: /Сохранить|Save/ }).last().click()

  const integrationRow = page
    .getByTestId('integration-row')
    .filter({ hasText: 'GitHub (official)' })
  await expect(integrationRow).toBeVisible()
  await expect(
    page.getByText(
      'docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server',
    ),
  ).toBeVisible()

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

  await page.getByRole('button', { name: /^Расписания$|^Routines$/ }).click()
  await expect(page.getByText(/Пока нет расписаний|No routines yet/)).toBeVisible()

  await page.getByRole('button', { name: /Новое расписание|New routine/ }).click()
  await page.getByLabel(/^Название$|^Name$/).fill('Morning digest')
  await page.getByLabel(/Промпт|Prompt/).fill('Summarize overnight email')
  await page.getByRole('button', { name: /Сохранить|Save/ }).click()

  const routineRow = page.getByTestId('routine-row').filter({ hasText: 'Morning digest' })
  await expect(routineRow).toBeVisible()

  const routineSwitch = routineRow.getByRole('switch')
  await expect(routineSwitch).toHaveAttribute('data-state', 'checked')

  // VIVI_MOCK_AGENT is set for this suite (see the launch env above), so "run now" resolves
  // immediately with a canned result — runRoutine() short-circuits before ever spawning the real
  // Claude CLI.
  await routineRow.getByTitle(/Запустить сейчас|Run now/).click()
  await expect(routineRow.getByText(/Последний запуск|Last run/)).toBeVisible()

  await routineSwitch.click()
  await expect(routineSwitch).toHaveAttribute('data-state', 'unchecked')

  await routineRow.getByTitle(/Удалить|Delete/).click()
  await expect(page.getByText(/Пока нет расписаний|No routines yet/)).toBeVisible()
})

test('Command palette (UX-05): Ctrl/Cmd+K opens it, filters, runs an action, and Escape closes it', async () => {
  const searchBox = page.getByPlaceholder(/Поиск команд|Search commands/)

  await page.keyboard.press('Control+k')
  await expect(searchBox).toBeVisible()
  await expect(searchBox).toBeFocused()

  // A query matching nothing shows the empty state instead of silently listing everything.
  await searchBox.fill('zzzzznomatch')
  await expect(page.getByText(/Ничего не найдено|No matching commands/)).toBeVisible()
  await searchBox.fill('')

  // Currently on the Workshop view (left there by the previous test) — "Go to Activity" runs a
  // real navigation, proving the palette drives the same store the sidebar buttons do. Palette
  // entries are role="option" (a listbox pattern), not role="button", so that's what to query.
  await page.getByRole('option', { name: /Перейти в Активность|Go to Activity/ }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(/сделала Vivi|Vivi did/)
  await expect(searchBox).not.toBeVisible()

  await page.keyboard.press('Control+k')
  await page.getByRole('option', { name: /Перейти в Чат|Go to Chat/ }).click()
  // Unlike the (now unconditionally-visible) app h1, the composer placeholder only ever renders
  // on Chat, and its "…microphone" tail doesn't collide with the palette's own "Search commands…".
  await expect(page.getByPlaceholder(/микрофон|microphone/i)).toBeVisible()

  await page.keyboard.press('Control+k')
  await expect(searchBox).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(searchBox).not.toBeVisible()
})

test('ACP-03: plan panel, notice toast and slash-command autocomplete (mock triggers)', async () => {
  const composer = page.getByPlaceholder(/команду|command/i)
  await composer.fill('покажи план')
  await composer.press('Enter')

  // Plan panel: 1 of 2 entries completed.
  await expect(page.getByText(/План · 1\/2|Plan · 1\/2/)).toBeVisible()
  await expect(page.getByText('Read the file')).toBeVisible()
  await expect(page.getByText('Write the fix')).toBeVisible()
  // Collapsing hides the entries but keeps the summary line visible.
  await page.getByText(/План · 1\/2|Plan · 1\/2/).click()
  await expect(page.getByText('Read the file')).not.toBeVisible()
  await page.getByText(/План · 1\/2|Plan · 1\/2/).click()
  await expect(page.getByText('Read the file')).toBeVisible()

  // Notice toast.
  await expect(page.getByRole('status').filter({ hasText: 'mock: this is a notice' })).toBeVisible()

  // Slash-command autocomplete: filters by prefix, Enter inserts "/name " and shows its hint.
  await composer.fill('/')
  await expect(page.getByRole('option', { name: /create_plan/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /research/ })).toBeVisible()
  await composer.fill('/create')
  await expect(page.getByRole('option', { name: /create_plan/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /^research/ })).not.toBeVisible()
  await composer.press('Enter')
  await expect(composer).toHaveValue('/create_plan ')
  await expect(page.getByText('the goal')).toBeVisible()
  await composer.fill('')
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
