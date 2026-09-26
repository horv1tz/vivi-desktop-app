import { create } from 'zustand'
import type { AgentError, AgentUiEvent, RateLimitInfo, SessionState, TurnResult, UiBlock, UiMessage } from '@shared/events'
import type { SendArgs } from '@shared/ipc'
import { invoke, vivi } from '../lib/bridge'

interface ChatState {
  sessionId: string | null
  sessionState: SessionState
  status: 'compacting' | 'requesting' | 'retrying' | null
  statusDetail?: string
  model: string | null
  title: string | null
  messages: UiMessage[]
  lastResult: TurnResult | null
  totalCostUsd: number
  rateLimit: RateLimitInfo | null
  error: AgentError | null
  apply: (e: AgentUiEvent) => void
  send: (args: SendArgs) => Promise<void>
  interrupt: () => Promise<void>
  newSession: () => Promise<void>
  resume: (sessionId: string) => Promise<void>
  clearError: () => void
  hydrate: () => Promise<void>
}

function upsertMessage(messages: UiMessage[], msg: UiMessage): UiMessage[] {
  const idx = messages.findIndex((m) => m.id === msg.id)
  if (idx === -1) return [...messages, msg]
  const next = messages.slice()
  next[idx] = msg
  return next
}

function findToolBlock(messages: UiMessage[], toolUseId: string): { msgIdx: number; blockIdx: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const blocks = messages[i]!.blocks
    for (let j = 0; j < blocks.length; j++) {
      const b = blocks[j]
      if (b?.type === 'tool_use' && b.toolUseId === toolUseId) return { msgIdx: i, blockIdx: j }
    }
  }
  return null
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  sessionState: 'starting',
  status: null,
  model: null,
  title: null,
  messages: [],
  lastResult: null,
  totalCostUsd: 0,
  rateLimit: null,
  error: null,

  apply: (e) => {
    const s = get()
    switch (e.type) {
      case 'session':
        set({ sessionId: e.sessionId, sessionState: e.state, model: e.model ?? s.model, title: e.title ?? null, error: null })
        break
      case 'state':
        set({ sessionState: e.state, status: e.state === 'running' ? s.status : null })
        break
      case 'status':
        set({ status: e.status, statusDetail: e.detail })
        break
      case 'history':
        set({ messages: e.messages })
        break
      case 'user-message':
        set({ messages: upsertMessage(s.messages, e.message), error: null })
        break
      case 'assistant-start': {
        const msg: UiMessage = { id: e.messageId, role: 'assistant', blocks: [], timestamp: Date.now(), parentToolUseId: e.parentToolUseId, streaming: true }
        set({ messages: upsertMessage(s.messages, msg) })
        break
      }
      case 'text-delta': {
        const idx = s.messages.findIndex((m) => m.id === e.messageId)
        const messages = s.messages.slice()
        const base: UiMessage = idx === -1
          ? { id: e.messageId, role: 'assistant', blocks: [], timestamp: Date.now(), streaming: true }
          : { ...messages[idx]! }
        const blocks: UiBlock[] = base.blocks.slice()
        while (blocks.length <= e.blockIndex) blocks.push({ type: e.kind === 'thinking' ? 'thinking' : 'text', text: '' })
        const cur = blocks[e.blockIndex]!
        if (cur.type === 'text' || cur.type === 'thinking') blocks[e.blockIndex] = { ...cur, text: cur.text + e.text }
        base.blocks = blocks
        if (idx === -1) messages.push(base)
        else messages[idx] = base
        set({ messages })
        break
      }
      case 'tool-use': {
        const idx = s.messages.findIndex((m) => m.id === e.messageId)
        const messages = s.messages.slice()
        const base: UiMessage = idx === -1
          ? { id: e.messageId, role: 'assistant', blocks: [], timestamp: Date.now(), streaming: true, parentToolUseId: e.parentToolUseId }
          : { ...messages[idx]! }
        base.blocks = [...base.blocks, e.block]
        if (idx === -1) messages.push(base)
        else messages[idx] = base
        set({ messages })
        break
      }
      case 'tool-result': {
        const loc = findToolBlock(s.messages, e.toolUseId)
        if (!loc) break
        const messages = s.messages.slice()
        const msg = { ...messages[loc.msgIdx]! }
        const blocks = msg.blocks.slice()
        const block = blocks[loc.blockIdx]
        if (block?.type === 'tool_use') blocks[loc.blockIdx] = { ...block, result: e.result }
        msg.blocks = blocks
        messages[loc.msgIdx] = msg
        set({ messages })
        break
      }
      case 'tool-update': {
        const loc = findToolBlock(s.messages, e.toolUseId)
        if (!loc) break
        const messages = s.messages.slice()
        const msg = { ...messages[loc.msgIdx]! }
        const blocks = msg.blocks.slice()
        const block = blocks[loc.blockIdx]
        if (block?.type === 'tool_use') blocks[loc.blockIdx] = { ...block, input: e.input ?? block.input, name: e.name ?? block.name }
        msg.blocks = blocks
        messages[loc.msgIdx] = msg
        set({ messages })
        break
      }
      case 'assistant-message':
        set({ messages: upsertMessage(s.messages, { ...e.message, streaming: false }) })
        break
      case 'result':
        set({ lastResult: e.result, totalCostUsd: e.result.totalCostUsd, status: null })
        break
      case 'error':
        set({ error: e.error, status: null })
        break
      case 'rate-limit':
        set({ rateLimit: e.info })
        break
      case 'compact':
        break
    }
  },

  send: async (args) => {
    set({ error: null })
    await invoke('agent:send', args)
  },
  interrupt: async () => {
    await invoke('agent:interrupt')
  },
  newSession: async () => {
    await invoke('agent:newSession')
    set({ messages: [], lastResult: null, error: null, title: null })
  },
  resume: async (sessionId) => {
    const messages = await invoke('agent:resumeSession', sessionId)
    set({ messages, sessionId, lastResult: null, error: null })
  },
  clearError: () => set({ error: null }),
  hydrate: async () => {
    const snap = await invoke('agent:getState')
    set({ sessionId: snap.sessionId, sessionState: snap.state, model: snap.model, title: snap.title, totalCostUsd: snap.totalCostUsd })
  },
}))

vivi.on('agent:event', (e) => useChatStore.getState().apply(e))
