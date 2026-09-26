import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { shell } from 'electron'
import type { AuthStatus, LoginFlowEvent } from '@shared/events'
import type { AuthMode } from '@shared/settings'
import { settings } from '../settings/store'
import { secrets } from './secrets'
import { ClaudeLoginRunner } from './claude-login'
import { run } from '../agent/tools/util'
import { logger } from '../logging/log'

const log = logger('auth')

export interface AuthManagerDeps {
  claudeBinary: () => string | undefined
  claudeConfigDir: string
  baseEnv: () => Promise<NodeJS.ProcessEnv>
  onStatus: (s: AuthStatus) => void
  onLoginEvent: (e: LoginFlowEvent) => void
  /** Restart the agent process so new credentials apply. */
  onCredentialsChanged: () => Promise<void>
}

export class AuthManager {
  private runner: ClaudeLoginRunner | null = null
  private lastStatus: AuthStatus | null = null

  constructor(private readonly deps: AuthManagerDeps) {}

  get mode(): AuthMode {
    return settings().get().auth.mode
  }

  /** Env vars to inject into the agent subprocess for the current auth mode. */
  async envForAgent(): Promise<Record<string, string | undefined>> {
    switch (this.mode) {
      case 'api-key':
        return {
          ANTHROPIC_API_KEY: (await secrets().get('anthropicApiKey')) ?? undefined,
          CLAUDE_CODE_OAUTH_TOKEN: undefined,
        }
      case 'oauth-token':
        return {
          CLAUDE_CODE_OAUTH_TOKEN: (await secrets().get('claudeOauthToken')) ?? undefined,
          ANTHROPIC_API_KEY: undefined,
        }
      case 'claude-login':
      case 'existing-claude':
      default:
        // Credentials come from the (isolated or user) Claude config dir; make sure env keys don't shadow them.
        return { ANTHROPIC_API_KEY: undefined, CLAUDE_CODE_OAUTH_TOKEN: undefined }
    }
  }

  isolateConfig(): boolean {
    return this.mode !== 'existing-claude'
  }

  private async cliStatus(configDir: string | undefined): Promise<{
    loggedIn: boolean
    authMethod?: string
    email?: string
    org?: string
    subscription?: string
  } | null> {
    const bin = this.deps.claudeBinary()
    if (!bin) return null
    const env: NodeJS.ProcessEnv = {
      ...(await this.deps.baseEnv()),
      ANTHROPIC_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
    }
    if (configDir) env.CLAUDE_CONFIG_DIR = configDir
    else delete env.CLAUDE_CONFIG_DIR
    const r = await run(bin, ['auth', 'status', '--json'], { timeoutMs: 20_000, env })
    try {
      const json = JSON.parse(
        r.stdout
          .trim()
          .split('\n')
          .find((l) => l.trim().startsWith('{')) ?? '{}',
      ) as {
        loggedIn?: boolean
        authMethod?: string
        email?: string
        orgName?: string
        organization?: string
        subscriptionType?: string
      }
      return {
        loggedIn: !!json.loggedIn,
        authMethod: json.authMethod,
        email: json.email,
        org: json.orgName ?? json.organization,
        subscription: json.subscriptionType,
      }
    } catch {
      log.warn('auth status parse failed', r.stdout.slice(0, 200), r.stderr.slice(0, 200))
      return null
    }
  }

  async status(): Promise<AuthStatus> {
    const mode = this.mode
    // SEC-06: a property of the OS secret store, not of how the user is currently signed in —
    // the same for every branch below.
    const secretsSecure = secrets().isSecure
    let status: AuthStatus
    try {
      switch (mode) {
        case 'api-key':
          status = {
            mode,
            loggedIn: secrets().has('anthropicApiKey'),
            authMethod: 'api_key',
            secretsSecure,
          }
          break
        case 'oauth-token':
          status = {
            mode,
            loggedIn: secrets().has('claudeOauthToken'),
            authMethod: 'oauth_token',
            secretsSecure,
          }
          break
        case 'claude-login': {
          const s = await this.cliStatus(this.deps.claudeConfigDir)
          status = {
            mode,
            loggedIn: s?.loggedIn ?? hasCredentialsFile(this.deps.claudeConfigDir),
            authMethod: s?.authMethod,
            email: s?.email,
            organization: s?.org,
            subscriptionType: s?.subscription,
            secretsSecure,
          }
          break
        }
        case 'existing-claude': {
          const s = await this.cliStatus(undefined)
          status = {
            mode,
            loggedIn: s?.loggedIn ?? hasCredentialsFile(join(homedir(), '.claude')),
            authMethod: s?.authMethod,
            email: s?.email,
            organization: s?.org,
            subscriptionType: s?.subscription,
            secretsSecure,
          }
          break
        }
        default:
          status = { mode: 'none', loggedIn: false, secretsSecure }
      }
    } catch (err) {
      status = { mode, loggedIn: false, error: (err as Error).message, secretsSecure }
    }
    this.lastStatus = status
    this.deps.onStatus(status)
    return status
  }

  /** Whether the user's own Claude Code CLI login exists (for the "use existing login" option). */
  hasExistingClaudeLogin(): boolean {
    return hasCredentialsFile(join(homedir(), '.claude')) || process.platform === 'darwin'
  }

  async startClaudeLogin(method: 'claudeai' | 'console'): Promise<void> {
    const bin = this.deps.claudeBinary()
    if (!bin) throw new Error('Claude Code binary not found')
    this.cancelLogin()
    const env = {
      ...(await this.deps.baseEnv()),
      CLAUDE_CONFIG_DIR: this.deps.claudeConfigDir,
      ANTHROPIC_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
    }
    const runner = new ClaudeLoginRunner({ claudeBinary: bin, env, method })
    this.runner = runner
    runner.on('event', (e: LoginFlowEvent) => {
      this.deps.onLoginEvent(e)
      if (e.phase === 'url' && e.url) void shell.openExternal(e.url)
    })
    runner.on('done', (e: LoginFlowEvent) => {
      this.runner = null
      if (e.phase === 'success') {
        settings().update({ auth: { mode: 'claude-login' } })
        void this.status().then(() => this.deps.onCredentialsChanged())
      }
    })
    runner.start()
  }

  submitLoginCode(code: string): void {
    if (!this.runner) throw new Error('no login in progress')
    this.runner.submitCode(code)
  }

  cancelLogin(): void {
    this.runner?.cancel()
    this.runner = null
  }

  async setOauthToken(token: string): Promise<AuthStatus> {
    const t = token.trim()
    if (!/^sk-ant-oat/i.test(t) && t.length < 20)
      throw new Error('This does not look like a Claude OAuth token')
    await secrets().set('claudeOauthToken', t)
    settings().update({ auth: { mode: 'oauth-token' } })
    await this.deps.onCredentialsChanged()
    return this.status()
  }

  async setApiKey(key: string): Promise<AuthStatus> {
    const k = key.trim()
    if (!/^sk-ant-/i.test(k)) throw new Error('Anthropic API keys start with sk-ant-')
    await secrets().set('anthropicApiKey', k)
    settings().update({ auth: { mode: 'api-key' } })
    await this.deps.onCredentialsChanged()
    return this.status()
  }

  async useExistingClaude(): Promise<AuthStatus> {
    settings().update({ auth: { mode: 'existing-claude' } })
    await this.deps.onCredentialsChanged()
    return this.status()
  }

  async logout(): Promise<AuthStatus> {
    this.cancelLogin()
    const mode = this.mode
    if (mode === 'claude-login') {
      const bin = this.deps.claudeBinary()
      if (bin) await run(bin, ['auth', 'logout'], { timeoutMs: 20_000 }).catch(() => undefined)
    }
    secrets().delete('claudeOauthToken')
    secrets().delete('anthropicApiKey')
    settings().update({ auth: { mode: 'none' } })
    await this.deps.onCredentialsChanged()
    return this.status()
  }

  get last(): AuthStatus | null {
    return this.lastStatus
  }
}

function hasCredentialsFile(dir: string): boolean {
  const file = join(dir, '.credentials.json')
  if (!existsSync(file)) return false
  try {
    const json = JSON.parse(readFileSync(file, 'utf8')) as {
      claudeAiOauth?: { accessToken?: string }
    }
    return !!json.claudeAiOauth?.accessToken
  } catch {
    return true
  }
}
