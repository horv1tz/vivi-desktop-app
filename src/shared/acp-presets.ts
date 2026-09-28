/**
 * ACP-02: a small, hand-curated list of known ACP-compatible agent commands, offered as a
 * shortcut alongside the free-text `acpCommand` field — not a registry the ACP SDK itself
 * provides (it has none). Deliberately kept to entries that are independently verifiable (real
 * npm packages/CLI flags, checked against each project's own docs/README), rather than every
 * agent that might exist: an unverifiable command name in a picker would look supported when it
 * silently fails to spawn.
 */
export interface AcpPreset {
  id: string
  name: string
  /** Empty string = Vivi's own bundled adapter (the default when `acpCommand` is unset). Bare
   * executable only — matches `settings.agent.acpCommand`, which is spawned directly and never
   * shell-tokenized (unlike `acpArgs`, so a command containing its own arguments would just fail
   * to spawn as a single, space-containing "executable" name). */
  command: string
  /** Extra CLI args, in the same shell-quoted-string format as `settings.agent.acpArgs`. */
  args: string
  description: string
}

export const ACP_PRESETS: AcpPreset[] = [
  {
    id: 'claude',
    name: 'Claude (bundled)',
    command: '',
    args: '',
    description: 'The Claude Code ACP adapter Vivi ships with — no install needed.',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    command: 'gemini',
    args: '--acp',
    description: "Google's Gemini CLI in ACP mode. Requires `gemini` installed and on PATH.",
  },
  {
    id: 'codex-acp',
    name: 'Codex CLI',
    command: 'npx',
    args: '-y @agentclientprotocol/codex-acp',
    description: 'ACP adapter for OpenAI Codex CLI, run on demand via npx — no install needed.',
  },
]
