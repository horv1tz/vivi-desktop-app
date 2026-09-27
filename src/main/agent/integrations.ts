import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { Integration } from '@shared/settings'
import { splitArgs } from './acp/args'

/**
 * INT-01: turns the user's configured integrations into the shape the SDK backend's `mcpServers`
 * option expects. Only enabled integrations are included; disabled ones stay in settings but are
 * never actually launched. Pure — no fs/process access, so it's directly unit-testable.
 */
export function integrationsToMcpServers(
  integrations: Integration[],
): Record<string, McpServerConfig> {
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
      }
    }
  }
  return out
}
