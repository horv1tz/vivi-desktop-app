import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mainWindow } from './helpers'

// CU-07: the control HUD ("Vivi is controlling your computer") is a second BrowserWindow that
// loads the same overlay.html bundle as the voice palette, distinguished only by a `#hud` URL
// hash (see src/main/app/windows.ts's createHudWindow / src/renderer/overlay.tsx). Exercising the
// real trigger path (a live mouse/keyboard tool call) needs a working input driver, which isn't
// guaranteed in a headless CI sandbox — so this test instead opens a window against the exact
// same renderer file+hash the real HUD window loads, inside the real running app, and asserts the
// hash-based branching and the ControlHud component render correctly.
let app: ElectronApplication

test.beforeAll(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'vivi-hud-e2e-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ onboardingCompleted: true }))
  app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, VIVI_MOCK_AGENT: '1', NODE_ENV: 'production' },
    timeout: 60_000,
  })
  await mainWindow(app)
})

test.afterAll(async () => {
  await app?.close()
})

test('overlay.html#hud renders the "Vivi is controlling" bar instead of the voice palette', async () => {
  const before = app.windows().length
  await app.evaluate(async ({ BrowserWindow, app: electronApp }) => {
    // Playwright's CDP eval context has no require()/import() of its own, so build the path with
    // plain string concatenation instead of node:path (fine on POSIX; this test runs on Linux CI).
    const root = electronApp.getAppPath()
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: `${root}/out/preload/index.mjs`,
        contextIsolation: true,
        sandbox: false,
      },
    })
    await win.loadFile(`${root}/out/renderer/overlay.html`, { hash: 'hud' })
  })
  await expect.poll(() => app.windows().length).toBeGreaterThan(before)
  const hudPage = app.windows()[app.windows().length - 1]!
  await expect(
    hudPage.getByText(/controlling your computer|управляет вашим компьютером/),
  ).toBeVisible({ timeout: 10_000 })
  // The voice palette's own strings must NOT appear on the hud-hash page.
  await expect(hudPage.getByPlaceholder(/команду|command/i)).toHaveCount(0)
})
