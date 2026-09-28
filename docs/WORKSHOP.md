# Workshop: skills, integrations and scenarios

**Workshop** — a screen of its own in the sidebar, next to Activity and Settings, not buried
inside Settings — is where Vivi's behavior can be extended in three different ways: **skills**
(reusable instructions, plain text), **integrations** (external tool servers, real programs) and
**scenarios** (fixed, ready-made action sequences). They're grouped on one screen because they all
answer the same question — "how do I make Vivi better at something specific" — but they work very
differently underneath, and only one of the three is something Vivi can set up herself.

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
- **New skill** opens with a **Library** picker — a small set of ready-made skills (a code review
  checklist, a document-summary format, a file-organization convention, and a few others) that
  prefill the name/description/body. Picking one is just a fast starting point: everything it
  fills in is still plain text in the form, so you can edit or delete any part of it before saving
  the same as if you'd typed it yourself.

## Integrations

An integration is a real, external [MCP](https://modelcontextprotocol.io) server — a separate
program (or a remote server reached over HTTP) that Vivi connects to for extra tools, beyond her
own built-in ones. Two transports are supported:

- **stdio** — a local command Vivi launches as a subprocess (e.g. `npx -y @some/mcp-server`).
  Give it the command and, if needed, its arguments (shell-like quoting is supported, so
  `--root "/path with spaces"` works as one argument).
- **http** — a remote MCP server reached by URL.

**New integration** opens with a **Known MCP server** picker: a small library of real,
independently-verified servers (GitHub, Slack, Brave Search, Sequential Thinking) that prefills
the command/arguments and, for the ones that need credentials, the exact environment variable
name(s) they expect. Picking one doesn't install anything — most run on demand via `npx` (or, for
GitHub's official server, `docker`), the same as typing the command in yourself; you still need
the underlying tool (Node/npx, Docker, …) installed for the command to actually work.

A stdio integration can declare **environment variables** — e.g. a `GITHUB_PERSONAL_ACCESS_TOKEN`
the server needs to authenticate. Unlike the command/arguments, a variable's *value* is never
written to `settings.json`: it's saved straight into the same encrypted secret store used for your
Anthropic API key and proxy password (Electron `safeStorage` — see
[PRIVACY.md](./PRIVACY.md)), keyed to that one integration, and the form only ever shows whether a
value is currently saved, never the value itself. Add a variable with **Add variable**, name it,
enter its value, and save that row on its own — independent of the rest of the form. Removing a
variable's row deletes the stored value immediately, not just when you save the whole integration.

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

## Scenarios

A scenario is a named, ready-made sequence of concrete steps — for example "open Spotify, then
press play." When you ask for something a scenario already covers, Vivi runs it directly instead
of reasoning through each step from scratch: faster, and it always does exactly what you set up.

Each step is one of a small, fixed set of actions:

- **Open** — an app, file or URL (same as the `open` tool).
- **Wait** — pause for a number of milliseconds before the next step.
- **Press keys** — a key combo, e.g. `space` or `ctrl+shift+t`.
- **Type text** — literal text typed into whatever's focused.
- **Notify** — show a desktop notification.

**New scenario** opens with a **Library** picker — ready-made scenarios for Spotify music control
(play/pause, next/previous track, volume) and a quick weather check (opens a plain-text forecast
in the browser, no account needed). Every keyboard shortcut in the library was checked against
Spotify's own published shortcuts rather than guessed, and the two shortcuts that differ by
platform (next/previous track, volume) are resolved to the right modifier for the machine Vivi is
actually running on when you pick the preset — not written in Windows-only or Mac-only. As with
the skill and MCP libraries, picking one is a starting point: everything it fills in is still
plain, editable fields, the same as assembling a scenario by hand.

Steps run in order and can be reordered or removed while editing. Give the scenario a name, an
optional description, and a few example phrases (comma-separated) that should trigger it — these
are shown to Vivi so she can match a request like "play some music" to your "Play music" scenario.

**Scenarios are never something Vivi can create herself**, for the same reason integrations
aren't: unlike a skill, which is just text, a scenario performs real actions on your computer when
run. Assembling one is a decision only you make, here in the Workshop screen. Vivi can only ever
run an existing scenario (via the `run_scenario` tool, after checking `list_scenarios`), never
create, edit or delete one.

The step vocabulary is deliberately narrow — there's no "run any tool" step. A scenario is meant to
stay a small, reviewable macro you can read top to bottom and trust, not an open-ended way to chain
arbitrary actions.

## Troubleshooting

- **A skill I just saved doesn't seem to apply** — start a *new* chat (not "continue last
  session"); see the "takes effect starting with a new chat" note above.
- **An integration's tools never show up** — check you're on the SDK backend, not ACP (see the
  limitation above); check the command/URL is correct (a stdio integration with a command that
  isn't actually installed will simply fail to connect); toggle it off and back on, or restart
  Vivi, if you just installed the underlying program.
- **"a skill named … already exists"** — skill names must be unique (case-insensitive); rename the
  new one or edit the existing one instead. Scenario names must be unique the same way.
- **Vivi doesn't run my scenario when I ask for it** — check it's enabled, and that your phrasing
  is close to one of its example trigger phrases; add a phrase that matches how you actually ask.
- **A scenario step fails partway through** — `run_scenario` stops at the first failing step (e.g.
  a "press keys" step with no working input driver) and reports exactly which step failed and what
  ran before it, rather than silently skipping ahead.
