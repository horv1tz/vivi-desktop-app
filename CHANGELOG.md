# Changelog

All notable changes to Vivi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

No unreleased changes yet.

## [0.1.1] - 2026-09-26

### Fixed

- **ACP backend**: Windows argument/command handling for spawning agent processes, correct
  cancelled-vs-crashed turn classification, and enforcement of "always allow" rules for
  third-party ACP agents (previously only checked for the bundled Claude adapter).

### Added

- `docs/ROADMAP.md`: comprehensive development plan and roadmap covering current state,
  workstreams, release plan (0.1.x → 1.0 → 2.x), epic cards, and quality/security strategy.

## [0.1.0] - 2026-09-26

Initial public release.

### Added

- **Desktop shell**: Electron + React scaffold with main/renderer/overlay windows, tray icon,
  global hotkeys, typed IPC contract, and RU/EN interface (i18next).
- **Agent core**: Claude Agent SDK backend (`AgentSession`) running Claude Code in streaming-input
  mode, a session reducer that turns SDK messages into UI events, and a permission broker
  (`canUseTool`) backed by a category-based policy engine with a dangerous-command detector.
- **ACP backend**: an alternative way to reach Claude — Vivi spawns Claude Code as a separate
  process over the Agent Client Protocol via the official `claude-agent-acp` adapter (the same
  protocol used by Zed and JetBrains), or connects to any user-supplied third-party ACP agent.
  Vivi's own tools are served to the agent over a local MCP endpoint.
- **Computer control**: an in-process MCP tool server (`vivi`) for screenshots, mouse/keyboard
  input, window management, launching apps/files/URLs, clipboard, notifications, and system
  actions (volume, lock, sleep), plus a `remember` tool backed by `~/Vivi/memory/VIVI.md`.
  Input drivers use `robotjs` with native CLI fallbacks (`xdotool`/`ydotool`/`osascript`/PowerShell).
- **Permissions UI**: category-based permission dialogs (read auto-allowed; edit/exec/input/system
  need confirmation), an always-confirm list for dangerous commands (`rm -rf`, `sudo`, `shutdown`,
  force-push), a kill switch (`Ctrl/Cmd+Shift+Esc`), and a fail-safe (move the mouse to a screen
  corner to abort).
- **Authentication**: sign in with a Claude subscription (via the bundled Claude Code CLI), a
  long-lived `claude setup-token` token, or an Anthropic API key; secrets are stored through the
  OS secret store (Keychain / DPAPI / Secret Service).
- **Proxy support**: HTTP/HTTPS/SOCKS5 proxies with authentication and a custom CA certificate; a
  local HTTP bridge is started for SOCKS5 and authenticated proxies because Claude Code only
  understands `HTTPS_PROXY`.
- **Offline voice pipeline**: sherpa-onnx-based wake-word detection (keyword spotter and
  streaming-transcript strategies), Silero VAD (end-of-utterance and barge-in), streaming/offline
  STT (Zipformer, GigaAM, Whisper), Piper TTS with sentence-chunked, interruptible playback, and
  an optional OpenAI cloud STT/TTS provider.
- **Shell features**: autostart (login item) on Windows/macOS, a macOS PATH fix for GUI-launched
  apps, a push-to-talk hotkey, and microphone `MessagePort` re-delivery across window reloads.
- **Packaging & CI**: `electron-builder` configuration for Windows (NSIS), macOS (DMG/zip,
  hardened runtime and entitlements), and Linux (AppImage/deb) with the Claude Code binary bundled
  into the installer; a CI workflow (lint, typecheck, unit tests, Electron smoke tests under
  `xvfb`, packaged-build verification) and a release workflow that creates a GitHub Release and
  uploads installers on a tag push or manual dispatch.
- **Documentation**: `README.md` (RU + EN), `docs/ARCHITECTURE.md`, and `docs/PRIVACY.md`.

### Fixed

- Unsigned CI builds falling back correctly when no code-signing certificate is configured, the
  Debian package maintainer field, immediate GitHub Release creation on tag push, and Windows
  `.cmd`-based ACP agent command handling.
- ACP review pass: process/session lifecycle handling, permission mapping between Vivi's policy
  engine and ACP permission options, secret handling for third-party agents, and the release job's
  tag/version matching.

[Unreleased]: https://github.com/horv1tz/vivi-desktop-app/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/horv1tz/vivi-desktop-app/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/horv1tz/vivi-desktop-app/releases/tag/v0.1.0
