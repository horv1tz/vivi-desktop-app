# ACP (Agent Client Protocol)

By default, Vivi talks to Claude through the Claude Agent SDK directly (`agent.backend: 'sdk'`).
She can instead talk to any agent that speaks the
[Agent Client Protocol](https://agentclientprotocol.com/) — an editor/UI-agnostic protocol for
driving a coding/computer-use agent over stdio — by switching **Settings → Agent → Backend** to
`acp`. This page covers what that changes and what it doesn't.

## Why you'd use it

The `acp` backend is how Vivi hosts an agent other than Claude, or a customized Claude agent
launched through your own command, while keeping the same chat UI, permission prompts, voice
pipeline, and tool journal. If you just want Claude, `sdk` is the simpler, better-tested default —
`acp` exists for bringing your own agent binary.

## Configuration

- **`agent.backend`**: `sdk` (default) or `acp`.
- **`agent.acpCommand`**: the command to launch. Leave empty to use Vivi's bundled
  `claude-agent-acp` adapter (Claude itself, spoken over ACP instead of the SDK directly — mainly
  useful for testing the ACP path with a known-good agent). Set it to point at a third-party ACP
  agent's executable instead.
- **`agent.acpArgs`**: extra command-line arguments for that command, using shell-like quoting
  (so an argument containing spaces can be wrapped in quotes).

## What stays the same

Vivi's `PermissionBroker` — the same danger-command detection, the same "always allow" rules
store, the same AskUserQuestion routing to chat or voice — sits in front of an ACP-hosted agent
exactly as it does in front of the SDK backend. A third-party ACP agent's tool calls are checked
against identical policy and identical dangerous-command heuristics; there's no separate, weaker
code path for non-Claude agents. Session management (list, resume, rename), the activity journal,
cost/usage tracking, and the voice pipeline are all backend-agnostic — they were built against a
shared internal event stream that both backends produce.

## What's different

- **Permission bypass is capped.** Vivi's most permissive mode, `bypassPermissions`, relies on a
  hook the SDK lets us inject directly into Claude's own process to still catch genuinely
  dangerous commands even when "don't ask" is on. There's no way to inject that hook into an
  arbitrary external process, so under the `acp` backend `bypassPermissions` is remapped down to
  the next safest available mode — full unchecked bypass is never sent to a remote ACP agent, only
  to an in-process Claude session.
- **Credentials aren't shared with a custom agent command.** When `acpCommand` is set to something
  other than the bundled adapter, Vivi strips her own Claude credentials
  (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`) from that process's
  environment before launching it — a third-party agent has to bring its own credentials, the same
  way it would if you ran it standalone from a terminal. Proxy environment variables (see
  [`PROXY.md`](./PROXY.md)) are still passed through, since those configure network access rather
  than identity.
- **Session history export is unavailable for a non-Claude agent.** The SDK backend can peek at
  a past session's transcript non-disruptively; a generic ACP agent can only hand over history by
  actually loading that session as the active one, which would interrupt whatever's currently
  running. Rather than ship an inconsistent "sometimes works" export button, Vivi doesn't offer
  history export at all while the `acp` backend is active with a non-bundled agent.

## Troubleshooting

- **Agent fails to start** — check **Settings → Diagnostics** and the exported diagnostics log for
  the spawned command's exit code/stderr; a bad `acpCommand` path or missing binary is the most
  common cause.
- **Custom agent can't reach the network / Claude's API** — it doesn't inherit Vivi's stored
  Claude credentials by design (see above); configure the agent's own credentials the way its own
  documentation describes. If it also needs to go through your proxy, check
  [`PROXY.md`](./PROXY.md) — proxy environment variables reach it the same way they reach the SDK
  backend's subprocess.
- **Permission prompts feel different from the SDK backend** — expected for `bypassPermissions`
  specifically (see above); everything else should behave identically. If a third-party agent's
  tool calls aren't being categorized the way you expect, check **Settings → Diagnostics**'s
  activity journal to see exactly what tool name and input Vivi received from it.
