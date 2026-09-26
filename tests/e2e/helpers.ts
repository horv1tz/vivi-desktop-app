import type { ElectronApplication, Page } from '@playwright/test'

/** The app opens two windows (main + overlay); wait for the main one by title. */
export async function mainWindow(app: ElectronApplication, timeoutMs = 30_000): Promise<Page> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    for (const w of app.windows()) {
      const title = await w.title().catch(() => '')
      if (title === 'Vivi') {
        await w.waitForLoadState('domcontentloaded')
        return w
      }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('main window not found')
}
