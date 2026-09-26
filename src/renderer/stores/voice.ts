import { create } from 'zustand'
import type { VoiceState } from '@shared/events'
import { vivi } from '../lib/bridge'

interface VoiceStoreState {
  state: VoiceState
  detail?: string
  level: number
  transcript: string
  transcriptFinal: boolean
}

export const useVoiceStore = create<VoiceStoreState>(() => ({
  state: 'off',
  level: 0,
  transcript: '',
  transcriptFinal: false,
}))

vivi.on('voice:state', (e) =>
  useVoiceStore.setState({ state: e.state, detail: e.detail, level: e.level ?? 0 }),
)
vivi.on('voice:transcript', (e) =>
  useVoiceStore.setState({ transcript: e.text, transcriptFinal: e.final }),
)
vivi.on('voice:level', (level) => useVoiceStore.setState({ level }))
