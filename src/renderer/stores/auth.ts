import { create } from 'zustand'
import type { AuthStatus, LoginFlowEvent } from '@shared/events'
import { invoke, vivi } from '../lib/bridge'

interface AuthState {
  status: AuthStatus | null
  loading: boolean
  login: LoginFlowEvent | null
  refresh: () => Promise<void>
  startClaudeLogin: (method: 'claudeai' | 'console') => Promise<void>
  submitCode: (code: string) => Promise<void>
  cancelLogin: () => Promise<void>
  setOauthToken: (token: string) => Promise<void>
  setApiKey: (key: string) => Promise<void>
  useExistingClaude: () => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  status: null,
  loading: false,
  login: null,
  refresh: async () => {
    set({ loading: true })
    try {
      set({ status: await invoke('auth:getStatus') })
    } finally {
      set({ loading: false })
    }
  },
  startClaudeLogin: async (method) => {
    set({ login: { phase: 'starting' } })
    await invoke('auth:startClaudeLogin', method)
  },
  submitCode: async (code) => {
    await invoke('auth:submitLoginCode', code)
  },
  cancelLogin: async () => {
    await invoke('auth:cancelLogin')
    set({ login: null })
  },
  setOauthToken: async (token) => set({ status: await invoke('auth:setOauthToken', token) }),
  setApiKey: async (key) => set({ status: await invoke('auth:setApiKey', key) }),
  useExistingClaude: async () => set({ status: await invoke('auth:useExistingClaude') }),
  logout: async () => set({ status: await invoke('auth:logout') }),
}))

vivi.on('auth:status', (status) => useAuthStore.setState({ status }))
vivi.on('auth:loginFlow', (login) =>
  useAuthStore.setState({
    login: login.phase === 'success' || login.phase === 'cancelled' ? null : login,
  }),
)
