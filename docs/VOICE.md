# Voice

Vivi can be driven entirely by voice: a hotkey for push-to-talk, or an always-on wake word so you
never have to touch the keyboard. Speech recognition, wake-word detection, and speech synthesis
all run locally by default (via [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)); cloud
providers are an opt-in alternative.

## Activation

- **Push-to-talk**: `Ctrl/Cmd+Shift+Space` (configurable in **Settings → General**) opens the
  overlay palette and starts listening immediately; pressing it again (or the overlay's mic button)
  stops and sends what was captured.
- **Wake word ("Vivi" / "Виви")**: always-on, offline listening — say the wake word and start
  talking, no button needed. Toggle it from the tray menu or **Settings → Voice**.
- **Follow-up window**: after Vivi finishes speaking a reply, she keeps listening for a short
  window (8 seconds by default, adjustable in **Settings → Voice**, 0 disables it) without needing
  the wake word again, so a natural back-and-forth doesn't require saying "Vivi" before every turn.

### Wake-word detection strategy

Two strategies, selectable in **Settings → Voice** (`wakeWordStrategy`):

- **`transcript`** (the default) — the same continuous speech-recognition model used for normal
  dictation runs all the time; Vivi fuzzy-matches its partial transcript against "vivi"/"виви" and
  a couple of close variants. More CPU, generally more reliable for a Russian accent on "Виви."
- **`kws`** — a small, dedicated keyword-spotting model listens for the wake word specifically,
  lighter on CPU, less flexible about pronunciation.

A sensitivity slider tunes both. If the wake word fires too often on background noise, lower it;
if it doesn't fire reliably, raise it or try the other strategy.

## Models

All local speech models are [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) ONNX models,
downloaded on first use (through your configured proxy, if any) and cached under the app's user
data folder — see **Settings → Voice** for the model picker and download progress. Categories:

- **Speech recognition (STT)**: streaming Zipformer models for Russian and English, plus offline
  alternatives (GigaAM, Whisper) for higher accuracy or auto-language-detection at the cost of
  more CPU and latency.
- **Voice activity detection (VAD)**: Silero VAD — decides where an utterance starts and ends.
- **Text-to-speech (TTS)**: [Piper](https://github.com/rhasspy/piper) voices, several per language.
- **Keyword spotting (KWS)**: used only by the `kws` wake-word strategy.

**Cloud alternative**: `sttProvider`/`ttsProvider` can each be set to `openai` instead of `local`
(TTS also has a `system` option, using the OS's own text-to-speech) — useful if you'd rather not
download local models, at the cost of sending audio to a third party and needing network access.

Speech-recognition/synthesis language (`voice.language`: Russian / English / auto-detect) is a
separate setting from the interface language — set during onboarding's voice step, or later in
**Settings → Voice**.

## Devices and testing

**Settings → Voice** lets you pick a specific input (microphone) and output (speakers/headphones)
device, and has a live test widget: press the mic button and say something, or type a phrase and
have Vivi speak it back — the same widget also appears in onboarding's voice step, so you can
verify your microphone actually works before finishing setup.

## Interrupting Vivi (barge-in)

By default, sustained speech while Vivi is talking interrupts her (after a short grace period, so
the start of her own reply audio isn't mistaken for you interrupting). If you're in a noisy
environment — a TV on, other people talking nearby — **Settings → Voice** has an "interrupt only
with the wake word" option: with it on, ordinary nearby speech no longer cuts her off, only saying
"Vivi" again does. Echo cancellation and noise suppression are applied to the microphone input
either way.

## Voice permissions and questions

If the agent needs to ask for a permission (running a shell command, controlling the mouse, etc.)
or raises a multiple-choice question during a voice-driven turn, it's spoken aloud instead of only
shown on screen — Vivi starts listening for the answer without needing the wake word again. Say
"yes," "no," or "always allow" (or the Russian equivalents), or answer a single-choice question by
its number or by naming the option. Multi-question or multi-select prompts are shown on screen
only — the answer grammar for "the second and fourth options" isn't reliable enough to trust
by voice.

## Troubleshooting

- **Microphone permission** — macOS and Windows both gate microphone access; onboarding requests
  it, and **Settings → Diagnostics** shows the OS permission status alongside the live pipeline
  state. On Windows, a denial usually needs a manual fix in the OS privacy settings
  (`ms-settings:privacy-microphone`).
- **Wake word doesn't fire** — check **Settings → Diagnostics** for the live level meter while you
  speak (confirms the right input device is actually receiving audio), try raising the wake-word
  sensitivity, or switch strategy (`transcript` ↔ `kws`).
- **Model download fails or hangs** — usually a proxy/network issue; check **Settings → Proxy** and
  its "test connection" button. Downloads resume from where they left off.
- **No sound comes out** — check the selected output device in **Settings → Voice**; if you're
  using the `system` TTS provider, also check the OS's own default output device.
- **A reply gets stuck without finishing** — a watchdog recovers a stalled "thinking" or "speaking"
  state automatically after a timeout; if it happens repeatedly, check **Settings → Diagnostics**
  for a stuck pipeline state and consider switching away from a cloud STT/TTS provider if network
  latency is the likely cause.
