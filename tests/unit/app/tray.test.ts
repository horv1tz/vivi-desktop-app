import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/i18n', () => ({ t: (key: string) => key }))
// tray.ts transitively imports ./windows (BrowserWindow/screen/shell) and settings/store
// (electron-store, whose constructor touches app.getPath) — none of that is exercised by
// updateMenuItems, a pure function, but importing the module at all still needs these names to
// exist. Kept minimal on purpose: this only needs to satisfy module evaluation, not behavior.
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn() },
  Tray: vi.fn(),
  BrowserWindow: vi.fn(),
  app: {
    getVersion: () => '0.0.0-test',
    getPath: () => '/tmp',
    whenReady: () => Promise.resolve(),
  },
  nativeImage: { createFromPath: () => ({ setTemplateImage: vi.fn() }) },
  screen: { getAllDisplays: () => [], getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))

describe('updateMenuItems (tray update indicator)', () => {
  it('renders nothing when there is no update status', async () => {
    const { updateMenuItems } = await import('../../../src/main/app/tray')
    expect(updateMenuItems(null, vi.fn())).toEqual([])
    expect(updateMenuItems(undefined, vi.fn())).toEqual([])
  })

  it('renders nothing while merely checking or already up to date', async () => {
    const { updateMenuItems } = await import('../../../src/main/app/tray')
    expect(updateMenuItems({ type: 'checking' }, vi.fn())).toEqual([])
    expect(updateMenuItems({ type: 'not-available' }, vi.fn())).toEqual([])
  })

  it('renders a disabled "update available" item with the version', async () => {
    const { updateMenuItems } = await import('../../../src/main/app/tray')
    const items = updateMenuItems({ type: 'available', version: '0.3.0' }, vi.fn())
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ label: 'tray.updateAvailable 0.3.0', enabled: false })
    expect(items[0]!.click).toBeUndefined()
  })

  it('renders a disabled "downloading" item with the percent', async () => {
    const { updateMenuItems } = await import('../../../src/main/app/tray')
    const items = updateMenuItems({ type: 'downloading', percent: 42 }, vi.fn())
    expect(items).toEqual([{ label: 'tray.updateDownloading 42%', enabled: false }])
  })

  it('renders a clickable "restart to install" item that triggers the install callback', async () => {
    const { updateMenuItems } = await import('../../../src/main/app/tray')
    const onInstall = vi.fn()
    const items = updateMenuItems({ type: 'downloaded', version: '0.3.0' }, onInstall)
    expect(items).toHaveLength(1)
    expect(items[0]!.label).toBe('tray.updateReady 0.3.0')
    expect(items[0]!.enabled).not.toBe(false)
    ;(items[0]!.click as () => void)()
    expect(onInstall).toHaveBeenCalledOnce()
  })

  it('renders nothing on an error status (errors are surfaced in Settings, not the tray)', async () => {
    const { updateMenuItems } = await import('../../../src/main/app/tray')
    expect(updateMenuItems({ type: 'error', message: 'boom' }, vi.fn())).toEqual([])
  })
})
