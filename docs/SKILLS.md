# Skills and integrations

**Settings → Skills** is where Vivi's behavior can be extended in two different ways: **skills**
(reusable instructions, plain text) and **integrations** (external tool servers, real programs).
They're grouped on one screen because they answer the same question — "how do I make Vivi better
at something specific" — but they work very differently underneath, and only one of them is
something Vivi can set up herself.

## Skills

A skill is a named, reusable block of instructions — a house style, a checklist, a preferred way
to approach a recurring kind of task ("when writing commit messages, use imperative mood and keep
the subject line under 50 characters"). Every **enabled** skill is folded into Vivi's own system
prompt, under a `## Skills` heading, for every conversation from then on.

- **Vivi can create and edit these herself.** When you teach her a procedure worth remembering
  this way, she can call a tool to save it as a new skill (or update an existing one) without you
  opening this screen — that's the point of skills existing at all. You can also write one
  directly here: **New skill**, give it a name and (optional) one-line description, and write the
  instructions themselves in the body.
- Each skill can be toggled on/off independently, edited, or deleted, and shows whether **you** or
  **Vivi** created it.
- A skill you (or Vivi) save takes effect starting with a **new chat**, not the one you're
  currently in, and not by continuing/resuming the current session either — a conversation's
  system prompt is fixed at the moment it starts, the same way an already-`remember`'d fact only
  reaches a fresh conversation. Start a new chat to see it applied.
- Not for one-off facts (that's what [memory](../docs/ARCHITECTURE.md) is for) and never for
  secrets or credentials — a skill's text is plain, unencrypted content Vivi can read back to
  herself in every future conversation.
- There's a cap (100 skills, 8,000 characters per skill body) and skill names must be unique —
  hit either limit and you'll get a clear error, whether you're saving from this screen or Vivi is
  saving one herself.

## Integrations

An integration is a real, external [MCP](https://modelcontextprotocol.io) server — a separate
program (or a remote server reached over HTTP) that Vivi connects to for extra tools, beyond her
own built-in ones. Two transports are supported:

- **stdio** — a local command Vivi launches as a subprocess (e.g. `npx -y @some/mcp-server`).
  Give it the command and, if needed, its arguments (shell-like quoting is supported, so
  `--root "/path with spaces"` works as one argument).
- **http** — a remote MCP server reached by URL.

**Integrations are never something Vivi can add herself.** Unlike a skill, which is just text, an
integration actually runs a program you chose and hands its tools to the agent — that's a
capability decision only you make, through this screen, never something the agent grants itself.
Vivi's own tools (screenshot, mouse/keyboard, files, memory, skills, and so on) are unaffected by
whatever an integration adds; an integration's tools go through the exact same permission review
as everything else (read/edit/exec/etc., with the same "always allow" and confirmation prompts).

**Known limitation:** integrations apply to the built-in Agent SDK backend only. If
[`agent.backend`](./ACP.md) is set to `acp`, configured integrations are not currently passed
through to the ACP-hosted agent — this is a real gap, not a deliberate restriction, tracked for a
future release.

## Troubleshooting

- **A skill I just saved doesn't seem to apply** — start a *new* chat (not "continue last
  session"); see the "takes effect starting with a new chat" note above.
- **An integration's tools never show up** — check you're on the SDK backend, not ACP (see the
  limitation above); check the command/URL is correct (a stdio integration with a command that
  isn't actually installed will simply fail to connect); toggle it off and back on, or restart
  Vivi, if you just installed the underlying program.
- **"a skill named … already exists"** — skill names must be unique (case-insensitive); rename the
  new one or edit the existing one instead.
