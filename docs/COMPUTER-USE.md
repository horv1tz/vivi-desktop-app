# Computer use

Vivi can see the screen and drive the mouse and keyboard through a small set of tools exposed to
the agent as the in-process `vivi` MCP server: `screenshot`, `mouse`, `keyboard`, `list_windows`,
`windows`, `open`, `clipboard`, `system`. This page covers how that actually works on each
platform, what permissions it needs, and how to diagnose it when it doesn't.

## Drivers

Mouse and keyboard control go through an `InputDriver` abstraction with two implementations, tried
in this order:

1. **`robotjs`** — a native N-API module. Preferred everywhere it loads.
2. **Native CLI fallback** — shells out to OS tools when robotjs isn't available:
   - **macOS**: `osascript` (AppleScript, always present) for keys and window focus;
     [`cliclick`](https://github.com/BlueM/cliclick) (`brew install cliclick`) for mouse
     move/click/drag and for reading the cursor position — without it, mouse actions and the
     fail-safe corner check don't work.
   - **Windows**: PowerShell (`Add-Type`/`SendKeys`/`mouse_event` via P/Invoke). Always available.
   - **Linux**: `xdotool` (X11) if present, otherwise `ydotool` (works under Wayland too, needs the
     `ydotoold` daemon running). `xdotool` is checked first.

Whichever driver loaded, and why the other was skipped, is visible in **Settings → Diagnostics**
(and in the one-click diagnostics export) — check there first if computer control refuses to work.
You can force one driver with the `VIVI_INPUT_DRIVER=robotjs` or `VIVI_INPUT_DRIVER=native`
environment variable, mainly useful for testing.

Some actions have no `ydotool` equivalent and fail outright on a Wayland-only setup: holding the
mouse button down/up, scrolling, and reading the current cursor position (which the fail-safe
corner check depends on — see below). If you're on Wayland and these matter to you, X11 (or a
Wayland compositor with good `ydotool` coverage) will work better than pure `ydotool`.

## Permissions by platform

| Platform | What's needed |
|---|---|
| **macOS** | System Settings → Privacy & Security: **Screen Recording** (for `screenshot`) and **Accessibility** (for mouse/keyboard control). **Automation** (Apple Events) is needed for `osascript` to drive other apps' windows — onboarding requests and shows the status of all three. Before every `mouse`/`keyboard` action Vivi checks Accessibility, and before every `windows` focus/minimize it also checks Automation; a denial returns a clear tool error pointing at the exact System Settings pane to fix, instead of letting the action silently do nothing. Check **Settings → Diagnostics** and the permission screen in onboarding (also reachable by rerunning it: **Settings → About → Run setup again**). |
| **Windows** | No extra OS permission is normally needed. Windows may prompt for a security consent the first time a UI-automation action runs against an elevated window; running Vivi elevated too avoids this but isn't required for normal apps. |
| **Linux (X11)** | Works out of the box with `xdotool` installed (most desktop distros have it, or `apt install xdotool`). |
| **Linux (Wayland)** | Install `ydotool` and make sure its `ydotoold` daemon is running (it usually needs to run as a systemd service with access to `/dev/uinput`) — see your distro's `ydotool` package docs for the exact setup. Screenshot capture uses Electron's `desktopCapturer`, which goes through the XDG desktop portal on Wayland and may itself prompt for one-time screen-share consent. |

## Screenshots

`screenshot` captures a display (or a logical-pixel region within one) via Electron's
`desktopCapturer`, downscales it to at most 1568px on the long side, and returns it as PNG or
JPEG. **Settings → Agent** has a format/quality control: PNG is lossless but larger and slower to
transmit; JPEG at a configurable quality trades some fidelity for meaningfully cheaper, faster
screenshots — this applies live, no restart needed. Vivi's own windows (chat, overlay, control
HUD) are excluded from the capture via OS-level content protection, so they never show up inside
their own "here's what I see" screenshot.

`mouse` and `keyboard` accept `observe: true`, which waits for the screen to stop changing
(comparing successive frame hashes, capped at 1.5s by default) and returns a screenshot of the
settled result in the same tool call — one round trip instead of an action followed by a separate
`screenshot` call.

## Mouse and keyboard

`mouse` actions: `move`, `click`, `double_click`, `right_click`, `middle_click`, `down`, `up`,
`drag`, `scroll` (`dx`/`dy` in lines — positive `dy` scrolls down, positive `dx` scrolls right),
`position`. `down`/`up`/`drag` accept an optional `button` (`left`/`right`/`middle`, default
`left`).

`keyboard` actions: `type` (literal text — non-ASCII characters, e.g. Cyrillic, go through the
clipboard automatically since most native key-injection APIs can't type them directly), `press`
and `hotkey` (a key combo like `ctrl+shift+t`, `cmd+space`, `alt+tab`; `hotkey` is an alias of
`press`). Coordinates for `mouse` are always the **logical pixels of the screenshot you were just
given** — its reported size and scale factor tell you how to map back to the actual screen; Vivi
handles per-display DPI scaling internally.

**Known limitation:** typing ASCII text while a non-Latin OS keyboard layout is active (e.g. a
Cyrillic layout) isn't specially handled — only non-ASCII *content* goes through the clipboard, so
plain ASCII text is sent as literal key events, which some native input APIs can misinterpret
under a non-Latin active layout. There's no clean fix for this without either raw scan-code
injection (which the current drivers don't expose) or unconditionally routing *all* typed text
through the clipboard, which would stomp on your clipboard's contents on every keystroke — an
open item, not yet solved.

## Windows and apps

`list_windows` enumerates open windows (via
[`get-windows`](https://www.npmjs.com/package/get-windows)); `windows` focuses or minimizes one by
id, exact/partial title, app name or PID — focus the target app before typing into it. `open`
launches an application by name, opens a file/folder path, or opens a URL — prefer this over
driving a browser with the mouse to open something. `system` covers volume, lock, sleep, shutdown,
and restart.

## Safety

- **Kill switch**: `Ctrl/Cmd+Shift+Esc` (configurable in **Settings → General**) immediately stops
  any in-flight computer-control action and stays tripped until you send Vivi a new message —
  it does not silently re-arm itself on a timer.
- **Fail-safe corner**: before every mouse/keyboard action, Vivi checks whether the cursor is
  parked in a screen corner (a manual "grab the mouse back" gesture) and aborts if so. If the
  active driver can't report the cursor position at all (e.g. `ydotool` alone, or no `cliclick` on
  macOS), this check can't run — treated as "unknown," not silently skipped as "safe."
- **Control HUD**: while the agent is moving the mouse or typing, a small click-through bar appears
  on screen showing the last input action and the kill-switch hotkey, so it's visible even when
  focus is on a different app.
- **Confirmation**: the first mouse/keyboard action in a turn asks for confirmation (this turn /
  this session / never) unless you've already granted a broader allow; risky shell commands
  (`rm -rf`, `sudo`, `shutdown`, a force-push, and similar) always require confirmation regardless
  of any "always allow" rule.

## Troubleshooting

- **"mouse control is not available on this system"** — no working driver. On Linux, install
  `xdotool` (X11) or `ydotool` + start `ydotoold` (Wayland). Check **Settings → Diagnostics** for
  the exact reason robotjs and the fallback both failed.
- **Clicks land in the wrong place on a multi-monitor Windows setup with mixed DPI** — should be
  handled automatically (Vivi calibrates against Electron's own reported cursor position on first
  use), but if it's still off, check whether display scaling changed after that calibration ran; a
  restart re-calibrates.
- **Screenshots show a black/empty window on Wayland** — this is usually a portal/consent issue,
  not a Vivi bug; check that the screen-share permission was actually granted when prompted.
- **Scroll actions fail on Wayland with only `ydotool`** — expected; `ydotool` has no scroll wheel
  equivalent yet. Switch to X11, or scroll via `keyboard` (Page Up/Down, arrow keys) instead.
