import { create } from 'zustand'

export type View = 'chat' | 'settings' | 'onboarding' | 'journal' | 'workshop'
export type SettingsSection =
  | 'general'
  | 'account'
  | 'agent'
  | 'memory'
  | 'voice'
  | 'proxy'
  | 'permissions'
  | 'usage'
  | 'diagnostics'
  | 'about'

interface UiState {
  view: View
  settingsSection: SettingsSection
  sidebarOpen: boolean
  setView: (v: View) => void
  openSettings: (section?: SettingsSection) => void
  toggleSidebar: () => void
}

export const useUiStore = create<UiState>((set) => ({
  view: 'chat',
  settingsSection: 'general',
  sidebarOpen: true,
  setView: (view) => set({ view }),
  openSettings: (section) => set({ view: 'settings', settingsSection: section ?? 'general' }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))
