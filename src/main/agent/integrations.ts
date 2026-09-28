import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { Integration } from '@shared/settings'
import { secrets } from '../auth/secrets'
import { splitArgs } from './acp/args'

/** INT-01: values live in the encrypted secret store, keyed by `integrationEnv:<id>:<key>` — never in settings.json. */
async function resolveEnv(it: Integration): Promise<{ env?: Record<string, string> }> {
  if (!it.env.length) return {}
  const env: Record<string, string> = {}
  for (const { key, hasValue } of it.env) {
    if (!hasValue) continue
    const value = await secrets().get(`integrationEnv:${it.id}:${key}`)
    if (value) env[key] = value
  }
  return Object.keys(env).length ? { env } : {}
}

export async function integrationsToMcpServers(
  integrations: Integration[],
): Promise<Record<string, McpServerConfig>> {
  const out: Record<string, McpServerConfig> = {}
  for (const it of integrations) {
    if (!it.enabled || !it.name.trim()) continue
    if (it.transport === 'http') {
      if (!it.url.trim()) continue
      out[it.name] = { type: 'http', url: it.url.trim() }
    } else {
      if (!it.command.trim()) continue
      out[it.name] = {
        type: 'stdio',
        command: it.command.trim(),
        args: it.args.trim() ? splitArgs(it.args.trim()) : [],
        ...(await resolveEnv(it)),
      }
    }
  }
  return out
}
