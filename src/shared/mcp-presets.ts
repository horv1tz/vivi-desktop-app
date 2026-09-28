/**
 * INT-01: a small, hand-curated library of known MCP servers, offered as a shortcut in the
 * Integrations tab alongside manual entry. Kept to entries independently verified against each
 * project's own published package metadata and README (exact npm package name/version, exact
 * command, exact env var names) rather than every MCP server that might exist — an unverifiable
 * command here would look supported when it silently fails to spawn, and a wrong env var name
 * would look configured while the server never actually authenticates.
 *
 * Deliberately excludes servers that mostly duplicate what Vivi's own agent tools and built-in
 * `vivi` MCP server already cover (local file read/write, web fetch/search, browser automation,
 * memory) — the point of this list is servers that add a capability Vivi doesn't have natively.
 * Also excludes the official filesystem/postgres/sqlite/puppeteer reference servers: as of this
 * writing they're archived upstream (unmaintained), so recommending them would be bad advice.
 */
export interface McpPresetEnvVar {
  key: string
  label: string
  hint?: string
}

export interface McpPreset {
  id: string
  name: string
  /** Bare executable, matches `Integration.command` — spawned directly, never shell-tokenized. */
  command: string
  /** Shell-quoted-string args, in the same format as `Integration.args`. */
  args: string
  description: string
  /** Named env vars the server needs; the user supplies values, stored in the encrypted secret store. */
  envVars?: McpPresetEnvVar[]
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-sequential-thinking',
    description:
      "Anthropic's official step-by-step reasoning scratchpad tool. No account or API key needed — runs on demand via npx.",
  },
  {
    id: 'github',
    name: 'GitHub (official)',
    command: 'docker',
    args: 'run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server',
    description:
      "GitHub's official MCP server — structured tools for issues, PRs, repos and code search, beyond what plain git/gh via the terminal gives the agent. Requires Docker installed and running.",
    envVars: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'Personal access token',
        hint: 'github.com/settings/tokens — a fine-grained token scoped to only the repos you want Vivi to touch.',
      },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    command: 'npx',
    args: '-y slack-mcp-server@latest --transport stdio',
    description:
      'Read channel history and post messages in Slack. Requires a bot token from a Slack app installed to your workspace.',
    envVars: [
      {
        key: 'SLACK_MCP_XOXB_TOKEN',
        label: 'Bot token',
        hint: 'Starts with xoxb- — create an app at api.slack.com/apps, add the needed scopes, and install it to your workspace.',
      },
    ],
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    command: 'npx',
    args: '-y @brave/brave-search-mcp-server --transport stdio',
    description:
      "An alternative web search provider alongside Vivi's built-in search — useful for comparing results or a privacy-focused index. Requires a free API key.",
    envVars: [{ key: 'BRAVE_API_KEY', label: 'API key', hint: 'api.search.brave.com/app/keys' }],
  },
]
