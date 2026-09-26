import { create } from 'zustand'
import type { PermissionDecision, PermissionRequest, QuestionRequest } from '@shared/events'
import { invoke, vivi } from '../lib/bridge'

interface PermissionState {
  pending: PermissionRequest[]
  questions: QuestionRequest[]
  respond: (requestId: string, decision: PermissionDecision) => Promise<void>
  answer: (requestId: string, answers: Record<string, string>) => Promise<void>
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pending: [],
  questions: [],
  respond: async (requestId, decision) => {
    set({ pending: get().pending.filter((p) => p.requestId !== requestId) })
    await invoke('permission:respond', requestId, decision)
  },
  answer: async (requestId, answers) => {
    set({ questions: get().questions.filter((q) => q.requestId !== requestId) })
    await invoke('question:respond', requestId, answers)
  },
}))

vivi.on('permission:request', (req) => usePermissionStore.setState((s) => ({ pending: [...s.pending.filter((p) => p.requestId !== req.requestId), req] })))
vivi.on('permission:resolved', ({ requestId }) => usePermissionStore.setState((s) => ({ pending: s.pending.filter((p) => p.requestId !== requestId) })))
vivi.on('question:request', (req) => usePermissionStore.setState((s) => ({ questions: [...s.questions.filter((q) => q.requestId !== req.requestId), req] })))
vivi.on('question:resolved', ({ requestId }) => usePermissionStore.setState((s) => ({ questions: s.questions.filter((q) => q.requestId !== requestId) })))
