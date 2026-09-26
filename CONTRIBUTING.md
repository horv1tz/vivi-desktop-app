# Contributing to Vivi

> Если вам удобнее по-русски: смело открывайте issue или PR на русском языке — это нормально для
> этого репозитория.

Thanks for your interest in Vivi. This document covers how to set up a dev environment, the code
style and branching conventions, how to run the test suite, and the main extension points if you
want to add a backend, an input driver, or a voice engine.

## Development environment

Requirements: Node.js `>=22.12.0` (see [`.nvmrc`](.nvmrc)) and npm. For a Linux dev machine you'll
also need `libgtk-3`, `libnss3`, `libasound2` (and `xvfb` to run the Electron e2e tests headlessly);
for mouse/keyboard control on Linux, X11 works out of the box and Wayland needs `ydotool`.

```bash
git clone https://github.com/horv1tz/vivi-desktop-app.git
cd vivi-desktop-app
npm install      # installs Electron and the platform package bundling the Claude Code binary
npm run dev      # electron-vite dev, with hot reload
```

Other scripts you'll use during development (see `package.json` → `scripts` for the authoritative
list):

| Script | What it does |
|---|---|
| `npm run dev` | Run the app in dev mode with hot reload (`electron-vite dev`) |
| `npm run build` | Production build of main/preload/renderer (`electron-vite build`) |
| `npm run preview` / `npm run start` | Preview a production build |
| `npm run typecheck` | Type-check both the Node side and the web side (runs `typecheck:node` + `typecheck:web`) |
| `npm run lint` | ESLint over the whole repo |
| `npm run format` | Format the repo with Prettier (writes changes) |
| `npm run format:check` | Check formatting without writing |
| `npm test` | Unit tests (Vitest, single run) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:e2e` | End-to-end tests (Playwright/Electron) |
| `npm run smoke:agent` | Exercise `AgentSession` against a real Claude Code process from plain Node (`scripts/smoke-agent.ts`) |
| `npm run dist:linux` / `dist:win` / `dist:mac` | Build installers with electron-builder |
| `npm run verify:dist` | Sanity-check an unpacked build (native modules, Claude binary present) |

Handy environment variables for local development (see `README.md` for more):

- `VIVI_MOCK_AGENT=1` — deterministic mock agent backend, useful for UI work without a Claude account.
- `VIVI_CLAUDE_BIN=/path/to/claude` — use a different Claude Code binary.
- `VIVI_INPUT_DRIVER=native|robotjs` — force a specific input driver.

## Code style

The codebase is TypeScript in strict mode (`strict: true`, `noUncheckedIndexedAccess`,
`noImplicitOverride` — see `tsconfig.json`). Formatting and linting are enforced by Prettier and
ESLint (`typescript-eslint`, plus React Hooks/Refresh rules for the renderer):

```bash
npm run lint           # ESLint
npm run format:check   # Prettier, check only
npm run format         # Prettier, write changes
```

Please run `npm run lint`, `npm run typecheck` and `npm run format:check` before opening a PR —
CI runs the same checks (`.github/workflows/ci.yml`) and will fail the build otherwise.

## Branching and pull requests

- Fork the repo (or create a branch if you have write access) and work off `main`.
- Commit messages follow a Conventional-Commits-ish style used throughout the history, e.g.
  `feat(agent): ...`, `fix(acp): ...`, `docs: ...`. A scope in parentheses is optional but
  encouraged when the change is localized to one area (`agent`, `acp`, `proxy`, `voice`,
  `release`, …).
- Keep PRs focused on one change; large unrelated refactors are easier to review split up.
- Fill in the PR template (`.github/pull_request_template.md`) — what changed and why, the related
  issue if any, and how you tested it.
- Open an issue first for anything large or behavior-changing so the approach can be discussed
  before you invest the time; small fixes and docs improvements can go straight to a PR.

## Running the test suite

- **Unit tests** (Vitest) cover the reducer, session state machine, permission policy and
  dangerous-command detector, the ACP translator, proxy bridge, tool argument builders, and the
  voice pipeline FSM:

  ```bash
  npm test
  ```

- **End-to-end tests** (Playwright, driving the packaged Electron app) run against a mock agent by
  default and need a virtual display on Linux:

  ```bash
  npm run build
  xvfb-run -a npx playwright test tests/e2e/smoke.spec.ts
  ```

- **Opt-in real-Claude e2e** (`tests/e2e/real-agent.spec.ts`, `tests/e2e/real-acp.spec.ts`) run the
  actual Claude Agent SDK / ACP backends against your own Claude account. They are **skipped by
  default** and only run when you explicitly opt in, because they spend real API or subscription
  usage:

  ```bash
  VIVI_E2E_REAL=1 npx playwright test tests/e2e/real-agent.spec.ts
  VIVI_E2E_REAL=1 npx playwright test tests/e2e/real-acp.spec.ts
  ```

  Don't enable `VIVI_E2E_REAL` in a PR from a fork unless you're aware it will use your own Claude
  credentials — CI does not run these by default.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the process layout (main / voice-worker /
renderer / overlay), the agent session lifecycle, how the two agent backends compare, and the voice
pipeline data flow. [`docs/PRIVACY.md`](docs/PRIVACY.md) covers what data goes where.
[`docs/ROADMAP.md`](docs/ROADMAP.md) has the full development plan, current known limitations, and
the epic backlog if you're looking for something to work on.

## Extension points

Vivi is built around a few interfaces meant to be swapped or extended without touching the rest of
the app:

- **`AgentBackend`** — `src/main/agent/backend.ts`. The abstraction between the UI and the actual
  agent implementation (`start`/`send`/`interrupt`/session management/`listModels`/event stream).
  `AgentController` owns exactly one backend at a time (`mock`, `sdk`, or `acp`), chosen by
  `settings.agent.backend`. The `mock` implementation is used in tests and for UI work without a
  Claude account; `sdk` wraps `@anthropic-ai/claude-agent-sdk`; `acp` talks to a Claude Code (or
  third-party) ACP agent over JSON-RPC. A new backend implements this interface and is wired into
  `AgentController`.

- **`InputDriver`** — `src/main/agent/tools/input-driver.ts`. The abstraction over mouse, keyboard
  and window control (`moveMouse`, `click`, `typeText`, `pressKeys`, `focusWindow`, …).
  Implementations live under `src/main/agent/tools/drivers/` (a `robotjs`-backed driver plus native
  CLI fallbacks per platform, selectable with `VIVI_INPUT_DRIVER`). A new driver — for example a
  future accessibility-tree-based one — implements this interface.

- **Voice engines** — `src/voice-worker/pipeline.ts` defines the pure, unit-testable state machine
  (`VoicePipeline`) that the voice worker runs, with three injectable engine interfaces:
  `WakeEngine` (wake-word detection), `VadEngine` (voice activity detection / barge-in), and
  `SttEngine` (streaming or offline speech-to-text). Current implementations (in
  `src/voice-worker/engines.ts` and related files) are sherpa-onnx-backed (KWS/transcript wake
  word, Silero VAD, Zipformer/GigaAM/Whisper STT, Piper TTS). Cloud voice is currently a single
  concrete class, `OpenAIVoiceProvider` (`src/main/voice/providers/openai.ts`), used directly by
  `VoiceOrchestrator` (`src/main/voice/orchestrator.ts`) rather than through a formal interface —
  introducing proper `SttProvider`/`TtsProvider` interfaces to plug in more cloud providers is
  tracked as a roadmap item (see `docs/ROADMAP.md`, epic VO-12) and not implemented yet, so please
  don't assume those interfaces exist when reading other docs or older discussions.

If you're extending one of these and aren't sure about the current shape of the interface, read
the file directly — this document intentionally doesn't restate the exact method signatures so it
doesn't go stale as they evolve.
