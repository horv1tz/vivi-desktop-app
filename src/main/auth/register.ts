import { handle } from '../ipc/handlers'
import type { AuthManager } from './manager'

export function registerAuthHandlers(auth: AuthManager): void {
  handle('auth:getStatus', () => auth.status())
  handle('auth:startClaudeLogin', (_e, method) => auth.startClaudeLogin(method))
  handle('auth:submitLoginCode', (_e, code) => auth.submitLoginCode(code))
  handle('auth:cancelLogin', () => auth.cancelLogin())
  handle('auth:setOauthToken', (_e, token) => auth.setOauthToken(token))
  handle('auth:setApiKey', (_e, key) => auth.setApiKey(key))
  handle('auth:useExistingClaude', () => auth.useExistingClaude())
  handle('auth:logout', () => auth.logout())
}
