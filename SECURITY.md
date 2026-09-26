# Security Policy

## Supported versions

Vivi is pre-1.0 and does not maintain long-term support branches. Only the **latest published
release** receives security fixes; please update before reporting an issue that may already be
fixed.

| Version | Supported |
|---|---|
| Latest release (see [Releases](https://github.com/horv1tz/vivi-desktop-app/releases)) | ✅ |
| Older releases | ❌ |

## Reporting a vulnerability

This is a personal, single-maintainer project — there is no dedicated security email. To report a
vulnerability:

- **Sensitive or exploitable issues** (secret leakage, remote code execution, permission bypass,
  credential handling, etc.): please open a
  [private GitHub Security Advisory](https://github.com/horv1tz/vivi-desktop-app/security/advisories/new)
  on this repository instead of a public issue, so it isn't disclosed before a fix is available.
- **Non-sensitive issues** (a hardening suggestion, a defense-in-depth gap that isn't practically
  exploitable, etc.): a regular [issue](https://github.com/horv1tz/vivi-desktop-app/issues) is
  fine.

There's no guaranteed response time — this is maintained on a best-effort basis — but reports are
read and triaged, and a fix or mitigation is prioritized over other work.

## Threat model and current posture

Vivi runs an AI agent (Claude, via the Agent SDK or ACP) with tools that read files, run shell
commands, and control the mouse/keyboard/screen **on your own machine, with your own OS user
permissions**. It is not a sandboxed or remote-access product: anything the agent's tools do, they
do as you. Please read this section honestly before relying on it for anything you consider
high-stakes.

What's in place today:

- **Category-based permissions.** Reads are auto-allowed; edits, command execution, input
  simulation and system actions require confirmation unless you've explicitly marked a rule
  "always allow". A kill switch (`Ctrl/Cmd+Shift+Esc`) and a mouse-to-corner fail-safe can abort an
  in-progress action.
- **A dangerous-command detector** flags things like `rm -rf`, `sudo`, `shutdown`, and force-pushes
  for confirmation even under a permissive policy.
- **Secrets** (API keys, OAuth tokens, proxy passwords) are stored through the OS secret store
  (Keychain / DPAPI / Secret Service via Electron `safeStorage`), and are not passed to
  user-configured third-party ACP agents.
- **Isolation from your own Claude Code config.** The bundled Claude process runs with
  `CLAUDE_CONFIG_DIR` pointed at Vivi's own app-data folder and `settingSources: []`, so it doesn't
  read or write your personal `~/.claude` configuration.
- The ACP MCP endpoint that exposes Vivi's computer-control tools to an agent process listens only
  on `127.0.0.1` and requires a per-process bearer token.

Known gaps, tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md) section 7 ("Threat model"):

- **Command-injection hardening is in progress, not complete.** Some tool implementations still
  build shell/PowerShell/AppleScript command strings by interpolation rather than passing
  arguments as argv/env; this is being closed out (roadmap epic SEC-01) but should be assumed
  incomplete until that epic is done.
- **`bypassPermissions` mode currently also bypasses the dangerous-command detector** in some
  paths — it is not yet guaranteed to still ask about clearly destructive commands (roadmap epic
  SEC-02).
- **Bash and other shell tools run with the user's own OS permissions and no sandbox.** There is no
  seccomp/AppArmor/Seatbelt-style sandbox around command execution today; sandboxed Bash execution
  is a planned, not-yet-implemented item (roadmap epic SEC-04).
- **No egress guard or prompt-injection content marking yet.** Content pulled from the web, files,
  or screenshots is not currently marked as untrusted in the prompt, and there's no warning before
  local data is sent to an external URL (roadmap epic SEC-05).
- **The local MCP/proxy bridge used by the ACP backend has no authentication of its own** beyond
  binding to `127.0.0.1`; a third-party ACP agent you configure receives the bearer token that
  unlocks Vivi's computer-control tools (though not your Claude API key or OAuth token) — only
  configure agents you trust. See [`docs/PRIVACY.md`](docs/PRIVACY.md) for what data flows where.
- **Supply-chain checks (dependency audit in CI, SBOM, provenance/attestations for release
  artifacts) are not yet set up** (roadmap epic SEC-07).

If you're evaluating Vivi for a security-sensitive use case, please read
[`docs/PRIVACY.md`](docs/PRIVACY.md) and section 7 of [`docs/ROADMAP.md`](docs/ROADMAP.md) in full
rather than relying on this summary alone.
