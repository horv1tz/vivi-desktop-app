# Changelog

All notable changes to Vivi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Auto-update**: checks for updates on startup and on demand (`electron-updater` against the
  GitHub release feed), with a toggle, status line, and restart-to-install button in
  Settings > About.
- **Diagnostics export**: a one-click "Export diagnostics" button in Settings > About writes app
  info, settings (never contains secrets — those live in the OS keychain), OS permission status,
  and a log tail to a single JSON file for support requests; a local (never uploaded) crash
  reporter is also enabled.
- **macOS Automation permission**: onboarding now shows and can request Automation (Apple Events)
  status alongside microphone/screen/accessibility, so a denial is visible before it causes a
  confusing failure in a computer-control action.
- CI now runs on Windows and macOS in addition to Linux, and gates every release: a tag push or
  release dispatch runs the full lint/typecheck/test/build/verify-dist suite before a GitHub
  Release is created or an installer is uploaded.
- A version with a SemVer pre-release tag (e.g. `0.2.0-beta.1`) now publishes as a GitHub
  pre-release, and electron-builder's own update-channel files follow the same tag.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/RELEASING.md`, issue/PR templates,
  `.nvmrc`, and CI/release badges on the README.
- Dependabot (npm + GitHub Actions), a CodeQL workflow, an informational `npm audit` step in CI,
  and SHA-256 checksums uploaded alongside every release installer.

### Fixed

- **Voice**: the default (transcript-match) wake-word strategy only ever recognized the Latin
  spelling "vivi", so it never reliably triggered on the Russian "Виви" a default install's speech
  model would actually transcribe.
- **Voice**: a single failed TTS synthesis for one sentence permanently stalled the rest of a
  reply's playback instead of just skipping that sentence; added watchdog timeouts so a
  never-finishing "thinking" or "speaking" state recovers instead of leaving the orb stuck, and
  surfaced microphone silence/device removal instead of staying silently armed.
- **Settings**: typing in a text field no longer restarts the Claude process or re-registers
  global hotkeys on every keystroke — changes commit on blur (or when a hotkey actually changes).
  Changing the model or permission mode also no longer restarts an in-flight response; it applies
  live to the running session instead.
- **Settings**: a corrupted settings file is now restored from an automatically kept backup
  instead of silently resetting every setting to defaults.
- **Computer control**: an unreadable cursor position was reported as a fake `(0,0)`, which the
  fail-safe corner-detector misread as "cursor parked in the corner" and tripped on every action;
  it's now correctly treated as "position unknown". Also fixes Windows multi-monitor DPI scaling,
  `ydotool` key combinations (were using X11 keysym names instead of evdev keycodes), previously
  missing Windows `mouseDown`/`mouseUp` and window-minimize support in the fallback input driver,
  and excludes Vivi's own windows from the screenshot tool so its chat/overlay never shows up in
  its own "here's what I see" capture.
- **ACP mode**: the chat cost line always showed `$0.00` regardless of actual spend; it now tracks
  the agent-reported cumulative cost and shows nothing (instead of a misleading $0.00) when no
  agent has reported one yet.
- **Voice mode**: a long-running session that mixed voice and text turns could get stuck always
  answering with (or without) voice-style brevity, because that state was a frozen flag set once
  at session start; each turn's origin is now marked on the message itself.

### Security

- Commands built from model-provided strings (PowerShell, AppleScript, `sh`) are now passed via
  environment variables or argv instead of interpolated into script text, closing several command
  injection paths; the Linux app-launch fallback no longer goes through a shell at all.
- Dangerous commands (`rm -rf`, `sudo`, force-push, etc.) now require confirmation even in
  "no permissions" (`bypassPermissions`) mode; `$HOME` is no longer automatically granted
  filesystem access, and screenshot/clipboard-read auto-allow are now separate opt-outs.
- The local MCP HTTP endpoint used by ACP mode now validates `Origin`/`Host` (DNS-rebinding
  guard), caps request body size, bounds request/header timeouts, and reaps abandoned sessions
  after a TTL instead of only on full shutdown.

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
