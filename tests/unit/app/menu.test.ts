import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'

vi.mock('../../../src/main/i18n', () => ({ t: (key: string) => key }))
// buildAppMenuTemplate/attachEditContextMenu are the units under test; Menu.buildFromTemplate and
// .popup are exercised directly (attachEditContextMenu calls them), the rest of `electron` is only
// needed to satisfy module evaluation, same minimal-mock approach as tests/unit/app/tray.test.ts.
const popup = vi.fn()
const buildFromTemplate = vi.fn((_template: unknown[]) => ({ popup }))
vi.mock('electron', () => ({
  Menu: { buildFromTemplate, setApplicationMenu: vi.fn() },
}))

function findByLabel(
  items: MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions | undefined {
  return items.find((i) => i.label === label)
}

function actions() {
  return {
    onNewChat: vi.fn(),
    onCommandPalette: vi.fn(),
    onSettings: vi.fn(),
    onOpenLogs: vi.fn(),
    onReportIssue: vi.fn(),
  }
}

describe('buildAppMenuTemplate', () => {
  it('builds a macOS template with an app menu carrying Settings, and a separate File menu', async () => {
    const { buildAppMenuTemplate } = await import('../../../src/main/app/menu')
    const a = actions()
    const template = buildAppMenuTemplate('darwin', false, a)
    // macOS keeps Edit/Window/Help as bare roles (Electron supplies OS-localized labels for
    // those) — only the app menu, File and View menus carry our own i18n labels.
    expect(template.map((i) => i.label ?? i.role)).toEqual([
      'Vivi',
      'menu.file',
      'editMenu',
      'menu.view',
      'windowMenu',
      'help',
    ])

    const appMenu = template[0]!.submenu as MenuItemConstructorOptions[]
    const settingsItem = findByLabel(appMenu, 'menu.settings')!
    expect(settingsItem.accelerator).toBe('Cmd+,')
    ;(settingsItem.click as () => void)()
    expect(a.onSettings).toHaveBeenCalledOnce()
    expect(appMenu.some((i) => i.role === 'quit')).toBe(true)

    const fileMenu = template[1]!.submenu as MenuItemConstructorOptions[]
    const newChat = findByLabel(fileMenu, 'menu.newChat')!
    expect(newChat.accelerator).toBe('Cmd+N')
    ;(newChat.click as () => void)()
    expect(a.onNewChat).toHaveBeenCalledOnce()
    const palette = findByLabel(fileMenu, 'menu.commandPalette')!
    expect(palette.accelerator).toBe('Cmd+K')
    ;(palette.click as () => void)()
    expect(a.onCommandPalette).toHaveBeenCalledOnce()
  })

  it('builds a Windows/Linux template with one File menu carrying New Chat, Command Palette, Settings and Quit', async () => {
    const { buildAppMenuTemplate } = await import('../../../src/main/app/menu')
    const a = actions()
    for (const plat of ['win32', 'linux'] as const) {
      const template = buildAppMenuTemplate(plat, false, a)
      expect(template.map((i) => i.label ?? i.role)).toEqual([
        'menu.file',
        'menu.edit',
        'menu.view',
        'menu.help',
      ])
      const fileMenu = template[0]!.submenu as MenuItemConstructorOptions[]
      expect(findByLabel(fileMenu, 'menu.newChat')?.accelerator).toBe('Ctrl+N')
      expect(findByLabel(fileMenu, 'menu.commandPalette')?.accelerator).toBe('Ctrl+K')
      expect(findByLabel(fileMenu, 'menu.settings')?.accelerator).toBe('Ctrl+,')
      const quit = fileMenu.find((i) => i.role === 'quit')
      expect(quit?.label).toBe('menu.quit')
    }
  })

  it('includes reload/toggleDevTools in the View menu only when isDev is true', async () => {
    const { buildAppMenuTemplate } = await import('../../../src/main/app/menu')
    const a = actions()
    const dev = buildAppMenuTemplate('win32', true, a)
    const prod = buildAppMenuTemplate('win32', false, a)
    const devView = dev.find((i) => i.label === 'menu.view')!
      .submenu as MenuItemConstructorOptions[]
    const prodView = prod.find((i) => i.label === 'menu.view')!
      .submenu as MenuItemConstructorOptions[]
    expect(devView.some((i) => i.role === 'toggleDevTools')).toBe(true)
    expect(devView.some((i) => i.role === 'reload')).toBe(true)
    expect(prodView.some((i) => i.role === 'toggleDevTools')).toBe(false)
    expect(prodView.some((i) => i.role === 'reload')).toBe(false)
    // Zoom/fullscreen stay available either way — only the developer-facing items are gated.
    expect(prodView.some((i) => i.role === 'resetZoom')).toBe(true)
    expect(prodView.some((i) => i.role === 'togglefullscreen')).toBe(true)
  })

  it('wires the Help menu to report-issue and open-logs actions', async () => {
    const { buildAppMenuTemplate } = await import('../../../src/main/app/menu')
    const a = actions()
    const template = buildAppMenuTemplate('win32', false, a)
    const help = template.find((i) => i.label === 'menu.help')!
      .submenu as MenuItemConstructorOptions[]
    ;(findByLabel(help, 'menu.reportIssue')!.click as () => void)()
    expect(a.onReportIssue).toHaveBeenCalledOnce()
    ;(findByLabel(help, 'menu.openLogs')!.click as () => void)()
    expect(a.onOpenLogs).toHaveBeenCalledOnce()
  })
})

describe('attachEditContextMenu', () => {
  function fakeWindow() {
    const handlers: Record<string, (e: unknown, params: unknown) => void> = {}
    return {
      webContents: {
        on: vi.fn((event: string, handler: (e: unknown, params: unknown) => void) => {
          handlers[event] = handler
        }),
      },
      trigger: (params: unknown) => handlers['context-menu']?.({}, params),
    }
  }

  it('offers undo/redo/cut/copy/paste/select-all on an editable field, respecting editFlags', async () => {
    const { attachEditContextMenu } = await import('../../../src/main/app/menu')
    buildFromTemplate.mockClear()
    popup.mockClear()
    const win = fakeWindow()
    attachEditContextMenu(win as unknown as BrowserWindow)
    win.trigger({
      isEditable: true,
      selectionText: '',
      editFlags: {
        canUndo: true,
        canRedo: false,
        canCut: false,
        canCopy: true,
        canPaste: true,
        canSelectAll: true,
      },
    })
    expect(buildFromTemplate).toHaveBeenCalledOnce()
    const items = buildFromTemplate.mock.calls[0]![0] as MenuItemConstructorOptions[]
    const roles = items.filter((i) => i.role).map((i) => `${i.role}:${i.enabled}`)
    expect(roles).toEqual([
      'undo:true',
      'redo:false',
      'cut:false',
      'copy:true',
      'paste:true',
      'selectAll:true',
    ])
    expect(popup).toHaveBeenCalledWith({ window: win })
  })

  it('offers only Copy when text is selected outside an editable field', async () => {
    const { attachEditContextMenu } = await import('../../../src/main/app/menu')
    buildFromTemplate.mockClear()
    popup.mockClear()
    const win = fakeWindow()
    attachEditContextMenu(win as unknown as BrowserWindow)
    win.trigger({ isEditable: false, selectionText: 'hello', editFlags: {} })
    const items = buildFromTemplate.mock.calls[0]![0] as MenuItemConstructorOptions[]
    expect(items).toEqual([{ role: 'copy' }])
  })

  it('shows nothing when neither editable nor a selection', async () => {
    const { attachEditContextMenu } = await import('../../../src/main/app/menu')
    buildFromTemplate.mockClear()
    popup.mockClear()
    const win = fakeWindow()
    attachEditContextMenu(win as unknown as BrowserWindow)
    win.trigger({ isEditable: false, selectionText: '', editFlags: {} })
    expect(buildFromTemplate).not.toHaveBeenCalled()
    expect(popup).not.toHaveBeenCalled()
  })
})
