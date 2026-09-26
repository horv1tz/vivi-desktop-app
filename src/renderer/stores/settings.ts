import { create } from 'zustand'
import type { DeepPartial, Settings } from '@shared/settings'
import { defaultSettings } from '@shared/settings'
import { invoke, vivi } from '../lib/bridge'
import i18n from '../i18n'

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: DeepPartial<Settings>) => Promise<void>
  applyRemote: (s: Settings) => void
}

function applyTheme(s: Settings): void {
  const theme = s.appearance.theme
  const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
  document.documentElement.dataset.theme = resolved
  document.documentElement.lang = s.appearance.language
  if (i18n.language !== s.appearance.language) void i18n.changeLanguage(s.appearance.language)
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings(),
  loaded: false,
  load: async () => {
    const s = await invoke('settings:get')
    applyTheme(s)
    set({ settings: s, loaded: true })
  },
  update: async (patch) => {
    const s = await invoke('settings:update', patch)
    applyTheme(s)
    set({ settings: s })
  },
  applyRemote: (s) => {
    if (JSON.stringify(s) === JSON.stringify(get().settings)) return
    applyTheme(s)
    set({ settings: s })
  },
}))

vivi.on('settings:changed', (s) => useSettingsStore.getState().applyRemote(s))
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(useSettingsStore.getState().settings))
