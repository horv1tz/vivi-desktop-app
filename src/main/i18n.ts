import { settings } from './settings/store'

// Minimal main-process strings (tray, notifications). Renderer has full i18n via i18next.
const strings = {
  ru: {
    'tray.open': 'Открыть Vivi',
    'tray.overlay': 'Быстрая команда',
    'tray.wakeWord': 'Слушать «Виви»',
    'tray.stop': 'Остановить',
    'tray.quit': 'Выйти',
    'notify.ready': 'Vivi готова. Нажмите хоткей или скажите «Виви».',
    'notify.killSwitch': 'Остановлено: все действия прерваны.',
  },
  en: {
    'tray.open': 'Open Vivi',
    'tray.overlay': 'Quick command',
    'tray.wakeWord': 'Listen for “Vivi”',
    'tray.stop': 'Stop',
    'tray.quit': 'Quit',
    'notify.ready': 'Vivi is ready. Press the hotkey or say “Vivi”.',
    'notify.killSwitch': 'Stopped: all actions were interrupted.',
  },
} as const

export type MainStringKey = keyof (typeof strings)['en']

export function t(key: MainStringKey): string {
  const lang = settings().get().appearance.language
  return strings[lang][key] ?? strings.en[key]
}
