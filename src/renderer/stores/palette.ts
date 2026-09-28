import { create } from 'zustand'
import { vivi } from '../lib/bridge'
import { useChatStore } from './chat'
import { useUiStore } from './ui'

interface PaletteState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

// UX-05: the native app menu (main process) has no direct access to renderer state, so its "New
// Chat" / "Command Palette" / "Settings…" entries ask over IPC instead of trying to reach into
// these stores themselves — same actions the palette's own entries run, just reachable even when
// the window doesn't currently have DOM focus.
vivi.on('nav:command', (cmd) => {
  if (cmd === 'newChat') void useChatStore.getState().newSession()
  if (cmd === 'openSettings') useUiStore.getState().openSettings()
  if (cmd === 'openPalette') usePaletteStore.getState().setOpen(true)
})
