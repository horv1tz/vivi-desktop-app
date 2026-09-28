import { settings } from './settings/store'

// Minimal main-process strings (tray, notifications). Renderer has full i18n via i18next.
const strings = {
  ru: {
    'tray.open': 'Открыть Vivi',
    'tray.overlay': 'Быстрая команда',
    'tray.wakeWord': 'Слушать «Виви»',
    'tray.stop': 'Остановить',
    'tray.updateAvailable': 'Доступно обновление',
    'tray.updateDownloading': 'Загрузка обновления…',
    'tray.updateReady': 'Обновление готово — перезапустить, версия',
    'tray.quit': 'Выйти',
    'notify.ready': 'Vivi готова. Нажмите хоткей или скажите «Виви».',
    'notify.killSwitch': 'Остановлено: все действия прерваны.',
    'notify.updateReady':
      'Обновление готово к установке. Перезапустите Vivi, чтобы применить версию',
    'menu.file': 'Файл',
    'menu.edit': 'Правка',
    'menu.view': 'Вид',
    'menu.help': 'Справка',
    'menu.newChat': 'Новый чат',
    'menu.commandPalette': 'Командная палитра',
    'menu.settings': 'Настройки…',
    'menu.quit': 'Выйти',
    'menu.reportIssue': 'Сообщить о проблеме',
    'menu.openLogs': 'Открыть папку логов',
  },
  en: {
    'tray.open': 'Open Vivi',
    'tray.overlay': 'Quick command',
    'tray.wakeWord': 'Listen for “Vivi”',
    'tray.stop': 'Stop',
    'tray.updateAvailable': 'Update available',
    'tray.updateDownloading': 'Downloading update…',
    'tray.updateReady': 'Update ready — restart to install',
    'tray.quit': 'Quit',
    'notify.ready': 'Vivi is ready. Press the hotkey or say “Vivi”.',
    'notify.killSwitch': 'Stopped: all actions were interrupted.',
    'notify.updateReady': 'An update is ready to install. Restart Vivi to apply version',
    'menu.file': 'File',
    'menu.edit': 'Edit',
    'menu.view': 'View',
    'menu.help': 'Help',
    'menu.newChat': 'New Chat',
    'menu.commandPalette': 'Command Palette',
    'menu.settings': 'Settings…',
    'menu.quit': 'Quit',
    'menu.reportIssue': 'Report an Issue',
    'menu.openLogs': 'Open Logs Folder',
  },
} as const

export type MainStringKey = keyof (typeof strings)['en']

export function t(key: MainStringKey): string {
  const lang = settings().get().appearance.language
  return strings[lang][key] ?? strings.en[key]
}
