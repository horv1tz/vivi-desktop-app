import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../../src/shared/settings'
import type { UpdateStatus } from '../../../src/shared/events'

const mocks = vi.hoisted(() => {
  let listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  const fakeAutoUpdater = {
    autoDownload: true,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      ;(listeners[event] ??= []).push(cb)
      return fakeAutoUpdater
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const cb of listeners[event] ?? []) cb(...args)
    },
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  }
  const electronApp = { isPackaged: true }
  return {
    fakeAutoUpdater,
    electronApp,
    resetListeners: () => {
      listeners = {}
    },
  }
})

vi.mock('../../../src/main/logging/log', () => ({
  logger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}))
vi.mock('electron', () => ({ app: mocks.electronApp }))
vi.mock('electron-updater', () => ({
  autoUpdater: mocks.fakeAutoUpdater,
  default: { autoUpdater: mocks.fakeAutoUpdater },
}))

const { Updater } = await import('../../../src/main/app/updater')

function makeDeps(autoUpdate: boolean) {
  const statuses: UpdateStatus[] = []
  const settings = { ...defaultSettings(), features: { ...defaultSettings().features, autoUpdate } }
  return {
    statuses,
    deps: {
      getSettings: () => settings,
      onStatus: (s: UpdateStatus) => statuses.push(s),
    },
  }
}

beforeEach(() => {
  mocks.resetListeners()
  mocks.electronApp.isPackaged = true
  mocks.fakeAutoUpdater.autoDownload = true
  mocks.fakeAutoUpdater.checkForUpdates.mockReset()
  mocks.fakeAutoUpdater.downloadUpdate.mockReset()
  mocks.fakeAutoUpdater.quitAndInstall.mockReset()
})

describe('Updater', () => {
  it('no-ops in dev mode (app not packaged) without touching autoUpdater', async () => {
    mocks.electronApp.isPackaged = false
    const { statuses, deps } = makeDeps(true)
    const updater = new Updater(deps)

    await updater.checkForUpdates({ silent: false })
    await updater.downloadUpdate()
    await updater.quitAndInstall()

    expect(mocks.fakeAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(mocks.fakeAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(mocks.fakeAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(statuses).toEqual([])
  })

  it('no-ops when features.autoUpdate is disabled in settings', async () => {
    const { statuses, deps } = makeDeps(false)
    const updater = new Updater(deps)

    await updater.checkForUpdates({ silent: false })
    await updater.downloadUpdate()

    expect(mocks.fakeAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(mocks.fakeAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(statuses).toEqual([])
  })

  it('runs checking -> available -> downloading -> downloaded on a manual check that finds an update', async () => {
    mocks.fakeAutoUpdater.checkForUpdates.mockImplementation(async () => {
      mocks.fakeAutoUpdater.emit('checking-for-update')
      mocks.fakeAutoUpdater.emit('update-available', { version: '1.2.3' })
      return { isUpdateAvailable: true, updateInfo: { version: '1.2.3' } }
    })
    mocks.fakeAutoUpdater.downloadUpdate.mockImplementation(async () => {
      mocks.fakeAutoUpdater.emit('download-progress', { percent: 42.4 })
      mocks.fakeAutoUpdater.emit('update-downloaded', { version: '1.2.3' })
      return []
    })
    const { statuses, deps } = makeDeps(true)
    const updater = new Updater(deps)

    await updater.checkForUpdates({ silent: false })

    expect(statuses).toEqual([
      { type: 'checking' },
      { type: 'available', version: '1.2.3' },
      { type: 'downloading', percent: 42 },
      { type: 'downloaded', version: '1.2.3' },
    ])
    // autoDownload is turned off; the Updater drives the download itself once found.
    expect(mocks.fakeAutoUpdater.autoDownload).toBe(false)
    expect(mocks.fakeAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)

    await updater.quitAndInstall()
    expect(mocks.fakeAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('reports "not-available" on a manual check but stays silent on a startup check', async () => {
    mocks.fakeAutoUpdater.checkForUpdates.mockImplementation(async () => {
      mocks.fakeAutoUpdater.emit('checking-for-update')
      mocks.fakeAutoUpdater.emit('update-not-available')
      return { isUpdateAvailable: false, updateInfo: { version: '1.0.0' } }
    })

    const manual = makeDeps(true)
    await new Updater(manual.deps).checkForUpdates({ silent: false })
    expect(manual.statuses).toEqual([{ type: 'checking' }, { type: 'not-available' }])

    mocks.resetListeners()
    const silent = makeDeps(true)
    await new Updater(silent.deps).checkForUpdates({ silent: true })
    expect(silent.statuses).toEqual([])
    expect(mocks.fakeAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('surfaces an available update found by a silent startup check (but not the "checking" noise)', async () => {
    mocks.fakeAutoUpdater.checkForUpdates.mockImplementation(async () => {
      mocks.fakeAutoUpdater.emit('checking-for-update')
      mocks.fakeAutoUpdater.emit('update-available', { version: '2.0.0' })
      return { isUpdateAvailable: true, updateInfo: { version: '2.0.0' } }
    })
    mocks.fakeAutoUpdater.downloadUpdate.mockResolvedValue([])
    const { statuses, deps } = makeDeps(true)

    await new Updater(deps).checkForUpdates({ silent: true })

    expect(statuses).toEqual([{ type: 'available', version: '2.0.0' }])
    expect(mocks.fakeAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('reports an error status when checkForUpdates rejects, on both silent and manual checks', async () => {
    mocks.fakeAutoUpdater.checkForUpdates.mockImplementation(async () => {
      mocks.fakeAutoUpdater.emit('checking-for-update')
      throw new Error('network down')
    })

    const manual = makeDeps(true)
    await new Updater(manual.deps).checkForUpdates({ silent: false })
    expect(manual.statuses).toEqual([
      { type: 'checking' },
      { type: 'error', message: 'network down' },
    ])

    mocks.resetListeners()
    const silent = makeDeps(true)
    await new Updater(silent.deps).checkForUpdates({ silent: true })
    expect(silent.statuses).toEqual([{ type: 'error', message: 'network down' }])
  })

  it('reports an error status when the autoUpdater emits an "error" event during download', async () => {
    mocks.fakeAutoUpdater.checkForUpdates.mockImplementation(async () => {
      mocks.fakeAutoUpdater.emit('update-available', { version: '1.5.0' })
      return { isUpdateAvailable: true, updateInfo: { version: '1.5.0' } }
    })
    mocks.fakeAutoUpdater.downloadUpdate.mockImplementation(async () => {
      mocks.fakeAutoUpdater.emit('error', new Error('disk full'))
      throw new Error('disk full')
    })
    const { statuses, deps } = makeDeps(true)

    await new Updater(deps).checkForUpdates({ silent: false })

    expect(statuses).toEqual([
      { type: 'available', version: '1.5.0' },
      { type: 'error', message: 'disk full' },
      { type: 'error', message: 'disk full' },
    ])
  })

  it('quitAndInstall no-ops in dev mode', async () => {
    mocks.electronApp.isPackaged = false
    const { deps } = makeDeps(true)
    await new Updater(deps).quitAndInstall()
    expect(mocks.fakeAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })
})
