# Vivi architecture

```
┌──────────────────────────── Electron ────────────────────────────┐
│ main (Node)                                                     │
│  ├─ app/            windows (Main, Overlay), tray, shortcuts     │
│  ├─ agent/          AgentSession ← @anthropic-ai/claude-agent-sdk│
│  │    ├─ prompt.ts   Vivi system prompt (static + dynamic memory)│
│  │    ├─ tools/      in-process MCP server "vivi" (screen, input,│
│  │    │              windows, apps, clipboard, system, speak…)   │
│  │    └─ permissions/ policy → canUseTool → UI dialogs           │
│  ├─ auth/           claude auth login / setup-token / API key    │
│  ├─ proxy/          settings → env, session, undici, SOCKS bridge│
│  ├─ voice/          orchestrator, model manager, sentence chunker│
│  └─ ipc/            typed invoke/event contract                  │
│ utility: voice-worker (sherpa-onnx: KWS → VAD → STT; TTS)        │
│ renderer (React): chat, overlay orb, settings, dialogs, i18n     │
│ preload: contextBridge `window.vivi`                             │
└──────────────────────────────────────────────────────────────────┘
        │ spawn(resources/claude-bin/claude, env: auth + proxy, CLAUDE_CONFIG_DIR=<userData>/claude)
        ▼
   claude (native Claude Code binary) ──► api.anthropic.com
```

## Processes

| Process | Responsibility | Key files |
|---|---|---|
| main | windows, tray, hotkeys, settings, agent session, permissions, auth, proxy, voice orchestration | `src/main/**` |
| voice-worker (utilityProcess) | native sherpa-onnx engines: wake word, VAD, STT, TTS | `src/voice-worker/**` |
| renderer (main window) | chat UI, settings, microphone capture (AudioWorklet), TTS playback | `src/renderer/**` |
| renderer (overlay) | quick-command palette with the voice orb | `src/renderer/overlay.tsx` |
| claude (child) | Claude Code CLI driven by the Agent SDK in streaming-input mode | spawned by `AgentSession` |

## Agent session lifecycle

`AgentSession` (`src/main/agent/session.ts`) wraps one `query()` call in streaming-input mode:
an `AsyncQueue` feeds user messages, `SessionReducer` turns SDK messages into UI events
(coalescing text deltas every 33 ms), and `PermissionBroker` answers `canUseTool` using the
policy engine (`permissions/policy.ts`, `danger.ts`) or a dialog in the renderer.
`SdkBackend` keeps exactly one live process, spawns lazily on the first message and resumes the
selected session id; switching sessions disposes the old process.

Permission rules the user marks "always allow" are stored in Vivi's settings and passed to the
CLI on every spawn as inline `settings.permissions.allow` (the process runs with
`settingSources: []`, isolated from the user's own Claude Code configuration).

## Voice pipeline

```
mic (renderer AudioWorklet, 16 kHz Int16 20 ms frames)
   │ MessagePort (transferred renderer → worker, bypasses main)
   ▼
VoicePipeline (worker, pure FSM): armed → listening → finalizing → armed
   ├─ wake: KwsWake (BPE keyword spotter) or TranscriptWake (streaming STT + fuzzy match)
   ├─ vad:  Silero VAD (end-of-utterance, barge-in detection while speaking)
   └─ stt:  OnlineTransducerStt (partials) or OfflineStt (whisper / zipformer / GigaAM)
   ▼ final transcript
VoiceOrchestrator (main) → AgentSession.send({fromVoice:true})
   ▼ text deltas
SentenceChunker → worker TTS (Piper) → renderer TtsPlayer (ordered by seq, generation for barge-in)
```

## Packaging

`electron-builder.yml` keeps native modules unpacked (`asarUnpack`) and `scripts/after-pack.cjs`
copies the Claude Code binary from `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` into
`resources/claude-bin`; `src/main/util/claude-bin.ts` hands that path to the SDK.
`scripts/verify-dist.mjs` checks an unpacked build.
