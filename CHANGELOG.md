# Changelog

All notable changes to Vivi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Workshop screen** (INT-05, UX-11, UX-12): skills and integrations moved out of Settings into
  their own top-level screen, "Workshop", alongside Chat/Activity/Settings — the same nav pattern
  Activity already used, not a settings sub-panel.
- **Scenarios**: a new third tab in Workshop for named, ready-made action sequences (e.g. "open
  Spotify, then press play") — a small, fixed step vocabulary (open, wait, press keys, type text,
  notify). Vivi runs an existing scenario directly via a new `run_scenario` tool (after checking
  `list_scenarios`) instead of reasoning through each step itself. Like integrations, scenarios are
  never agent-creatable — only assembled by the user in the Workshop screen, since they perform
  real actions on the computer. Verified against the real model
  (`tests/e2e/real-agent-scenarios.spec.ts`, `VIVI_E2E_REAL=1`): given a seeded scenario and a
  matching request, Claude actually called `run_scenario` — confirmed via the action journal, not
  just the chat reply text.
- **Floating quick-access button**: a small always-on-top button pinned near the bottom-left corner
  of the screen (the closest a third-party Electron app can get to a Cortana-style taskbar button —
  there's no OS API to embed into the real Windows taskbar) that opens the overlay on click. New
  Settings → General toggle to show/hide it.

### Fixed

- The overlay, control HUD and new launcher windows all load the same `overlay.html` file (by
  hash), which carries its own `<title>` tag; Electron was letting the loaded page's title silently
  override each window's constructor-set title via `page-title-updated`, so the HUD and launcher
  windows' real native titles were always "Vivi Overlay", not "Vivi Control HUD" / "Vivi Quick
  Access" as intended — harmless before (nothing looked up the HUD window by title), but it broke
  title-based window lookup once a second always-created window shared the collision. Fixed by
  keeping each window's title fixed on `page-title-updated`.

## [0.3.0] - 2026-09-27

### Added

- **Update indicator outside Settings**: a downloaded, ready-to-install update now shows up in the
  tray menu ("Update ready — restart to install", or a non-clickable "Update available" /
  "Downloading update…" line while it's still in progress) and triggers a system notification when
  it finishes downloading — previously the only place this showed up at all was the About tab in
  Settings, so a background update could sit ready for days with zero visible indication.
- `docs/CODE-SIGNING.md`: what to buy/obtain for Windows code signing and macOS notarization to
  reduce SmartScreen/Gatekeeper warnings and antivirus false positives, the exact GitHub secret
  names the release workflow already reads, and the free Microsoft Defender / VirusTotal
  false-positive submission process for when a specific build gets flagged.
- **Skills and integrations** (new "Skills" settings screen): a skill is a named, reusable block
  of instructions folded into Vivi's own system prompt while enabled — a house style, a checklist,
  a preferred approach to a recurring kind of task. Vivi can create and update these herself (a new
  `manage_skill` tool, plus a read-only `list_skills`) when you teach her a procedure worth
  keeping, not just when you write one directly in Settings; verified end-to-end against the real
  model, which correctly called the tool and persisted the skill. An integration is a real external
  MCP server (stdio or http) merged into Vivi's tools — unlike a skill this is never
  agent-creatable, since it runs an actual program; only the built-in Agent SDK backend supports
  integrations today (see `docs/SKILLS.md`, including the documented ACP-mode limitation).

### Fixed

- **macOS notarization was hardcoded off**: `electron-builder.yml` set `mac.notarize: false`,
  which unconditionally skips notarization regardless of whether Apple credentials are configured
  — even after adding real `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` secrets,
  notarization would never have run. The field is now omitted so electron-builder's own
  environment-variable auto-detection (already exactly what `build.yml` exports from secrets)
  decides instead.

## [0.2.0] - 2026-09-27

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
- A screenshot format/quality setting (Settings > Agent): JPEG trades some fidelity for far
  smaller, cheaper, faster screenshots than the previous always-PNG default; applies live.
- **Action journal** ("Activity" in the sidebar): every tool call the agent makes — file, command,
  click, screenshot, and so on — is now recorded with its time, arguments, and result, survives a
  restart, and can be cleared or exported to a file. Works the same for both the built-in Agent
  SDK backend and ACP-hosted agents.
- CI now runs `prettier --check` (previously only available as a local `npm run format:check`, and
  not enforced anywhere), which had let real formatting drift build up across the repo over time.
- **Control HUD**: a small, click-through "Vivi is controlling your computer" bar now appears
  whenever the agent is about to move the mouse or type, showing the last input action and the
  kill-switch hotkey, so it stays visible even when a different app has focus. A "Stop" item was
  also added to the tray menu, wired to the same emergency stop as the hotkey.
- **Memory v2**: a new "Memory" settings tab lists what Vivi has learned about you (with a type —
  profile/preference/fact/project — and a date), lets you delete individual entries or clear
  everything, and replaces the old plain-text `VIVI.md` file with a structured, bounded store.
- **Action + observe**: the `mouse` and `keyboard` tools accept `observe: true`, which waits for
  the screen to settle (comparing frame hashes, capped at 1.5s by default) and returns a
  screenshot inline — one round trip instead of an action followed by a separate `screenshot` call.
- **Rate-limit lockout**: when the account hits a hard rate limit, the composer (text box, send
  and mic buttons) now actually disables itself with a live countdown to when it resets, instead
  of staying fully usable and letting you send messages that were always going to fail.
- **Follow-up listening window**: after Vivi finishes speaking a reply, it now keeps listening for
  a configurable window (8 seconds by default, adjustable in Settings > Voice, 0 disables it)
  without needing the wake word again, so a natural back-and-forth doesn't require saying "Vivi"
  before every follow-up.
- **Voice permissions and questions**: a permission dialog or `AskUserQuestion` prompt raised
  during a voice-driven turn is now spoken aloud ("Vivi wants to: run a shell command. Say yes,
  no, or always allow.") and the mic starts listening for the answer without needing the wake word
  again; "yes"/"no"/"always allow" (and their Russian equivalents) are recognized, and a
  single-select question can be answered by number or by naming the option. Previously these
  prompts were silent from voice mode's perspective — you had to look at the screen to notice one
  was even waiting.
- **Window state**: the main window now remembers its size, position, and maximized state across
  restarts instead of always reopening at a fixed 1180×780 in the middle of the primary display.
  If the display it was last on has since been disconnected, it re-centers on the current primary
  display with the saved size rather than restoring off-screen and unreachable.
- **Voice**: a new "Interrupt only with the wake word" setting (off by default) makes barge-in
  during Vivi's replies require saying "Vivi" again, instead of any sustained nearby speech (a TV,
  another conversation) cutting her off.
- **Usage tracking**: a new "Usage" settings tab shows total cost, tokens, and turns, plus a
  per-day breakdown for the last 14 days, from a local (never uploaded) history of every completed
  turn's cost and token usage. Includes a CSV export and a way to clear the history. Per-tool cost
  breakdown isn't included — neither the Agent SDK's nor ACP's usage reporting attributes cost
  below the level of a whole turn, so there's nothing finer-grained to record.
- **Onboarding**: finishing setup without a working sign-in now requires explicitly acknowledging
  a warning (a checkbox: "I understand Vivi won't respond until I sign in") instead of the old
  "Skip" button silently letting you through with no idea the assistant won't actually work yet. A
  new "Run setup again" button in Settings > About lets you redo onboarding without losing your
  other settings. The voice step now has its own speech-recognition/voice language choice
  (separate from the interface language) and a live mic/TTS test widget, so you can actually try
  the microphone and hear a reply before finishing setup.
- **Chat resilience**: a retryable error (overload, server error, a dropped process) now shows a
  "Retry" button that resends the exact same message, instead of making you retype it or leaving
  the turn stuck. An error boundary around both windows now shows a recoverable error screen
  ("Try to continue" or "Reload") instead of silently going blank if something throws while
  rendering. Four error codes (`oauth_org_not_allowed`, `invalid_request`, `model_not_found`,
  `server_error`) previously had no translated message and silently fell back to a generic one.
- **Computer control**: the `mouse` tool's `down`/`up`/`drag` actions now accept a `button`
  (left/right/middle) instead of always using the left button.
- **Diagnostics panel**: a new "Diagnostics" settings tab shows live voice pipeline state and
  levels, the actual input/output devices in use, and which input driver (robotjs or the OS
  command-line fallback) is active and why the other was skipped. The same driver information is
  now also included in the one-click diagnostics export.
- **Sessions**: past sessions in the sidebar can now be renamed in place (a pencil button next to
  delete) and filtered with a search box, instead of only being resumable or deletable.
- **User documentation**: four new guides — `docs/COMPUTER-USE.md` (input drivers, permissions by
  platform, screenshot handling, safety mechanisms), `docs/VOICE.md` (activation modes, wake-word
  strategies, local/cloud models, barge-in), `docs/ACP.md` (the ACP backend, what it shares with
  and how it differs from the default SDK backend), and `docs/PROXY.md` (proxy modes, exact
  settings fields, the CA-certificate limitation) — linked from both the Russian and English
  sections of the README.
- **macOS permission pre-flight**: before every `mouse`/`keyboard` action Vivi now checks the
  Accessibility TCC permission, and before every window focus/minimize it also checks Automation,
  returning a clear error naming the exact System Settings pane to fix instead of letting a denied
  action silently do nothing (robotjs's mouse/keyboard calls fail silently on macOS without
  Accessibility, so the agent previously had no way to tell a click never actually landed).

### Chore

- Added unit tests for three previously-untested modules: the `claude auth login` CLI output
  parser and login runner, `PermissionBroker` (the permission-prompt/AskUserQuestion bridge), and
  the keyboard-combo parsing helpers (`keys.ts`) — 62 new tests.

### Security

- **Prompt injection**: the system prompt previously said nothing about content read from the web,
  files, or screenshots being untrustworthy — a page or file containing text like "ignore previous
  instructions" had nothing telling the model not to comply. Added explicit guidance treating such
  content as data, not instructions, refusing embedded requests to run commands or reveal secrets,
  and requiring confirmation before sending local data to an external destination. Verified against
  the real model (not just the prompt text): a file containing an embedded "run this shell command"
  instruction is read and summarized without the command ever executing.

### Fixed

- **Computer control**: horizontal scroll (`dx`) was silently dropped by the fallback input driver
  on every platform (Windows only sent the vertical wheel event, Linux's xdotool path only pressed
  the vertical wheel buttons, and the macOS arrow-key fallback only pressed up/down) even though
  the `mouse` tool's schema already documented and accepted it.
- **Proxy**: "System" proxy mode only ever configured Electron's own network stack — the Claude
  CLI runs as a separate subprocess that never saw a proxy at all in that mode and silently
  connected directly, even though the UI showed the mode as active. It now resolves the actual
  OS/PAC proxy and passes it to the CLI the same way manual mode does (including routing a
  SOCKS-based system proxy through the existing local bridge).
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
- **Memory**: the system prompt kept the *first* 12,000 characters of the memory file, so as it
  grew, old facts (written first) always stayed in context while newer ones (appended at the end)
  silently fell out of it — e.g. an old address you corrected months ago could keep winning over
  the current one. Memory is now kept as dated entries and rendered newest-first, so it's the
  oldest facts that drop off once the budget is spent, not the newest. Note: existing `VIVI.md`
  files from 0.1.x are not migrated — Vivi now reads from the new store only, starting empty; the
  old file is left untouched on disk.

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
- The emergency stop (kill switch) used to silently re-enable mouse/keyboard control 5 seconds
  after being triggered, regardless of whether the user had done anything — defeating the point of
  an emergency stop for an agent that can be mid-task. It now stays tripped until the user
  explicitly sends the agent a new message.
- The dangerous-command detector no longer goes blind on commands nested inside a shell wrapper
  (`bash -c "rm -rf /"`, `powershell -Command "Remove-Item -Recurse"`, `cmd /c "..."`): its own
  "quoted strings are just data" heuristic used to blank out the wrapped payload along with truly
  inert quoted text, letting the actually-executed command slip past every pattern undetected.
  Also adds a `find … -delete` / `find … -exec rm` pattern that had no coverage at all.

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
