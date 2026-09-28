import type { ScenarioStep } from './events'

/**
 * A small library of ready-made scenarios offered as a shortcut when creating a new one — text
 * only, so (like `skill-presets.ts`) nothing here needs external package verification, but every
 * keyboard shortcut used below was checked against Spotify's own published shortcuts before being
 * written in, the same "verify, don't guess" bar applied to `mcp-presets.ts`'s commands: an
 * invented shortcut would look supported while silently doing the wrong thing (or nothing) on the
 * user's machine.
 *
 * Deliberately narrow, matching the scenario step vocabulary itself (open/wait/key/type/notify —
 * no "call any tool" step, see docs/WORKSHOP.md): these presets open/focus an app or a URL and
 * send it a keystroke, nothing more. They don't query anything (a scenario can't ask "is music
 * currently playing" or "what's the temperature"), so e.g. play/pause is a *toggle*, not a
 * guaranteed "play" — same honesty the hand-written docs example ("open Spotify, then press play")
 * already has.
 */
export interface ScenarioPreset {
  id: string
  name: { en: string; ru: string }
  description: { en: string; ru: string }
  /** Shown to the model to match a request to this scenario — mixed EN/RU on purpose, matched regardless of which language the user actually asks in. */
  triggerPhrases: string[]
  /** A 'key' step's `keys` may contain the literal placeholder `{mod}`, resolved by `resolvePresetSteps()` to `ctrl` or `cmd` for the current OS — Spotify's own next/prev/volume shortcuts differ by platform, unlike play/pause (Space, identical everywhere). */
  steps: ScenarioStep[]
}

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'play-pause-music',
    name: { en: 'Play/pause music (Spotify)', ru: 'Играть/пауза музыки (Spotify)' },
    description: {
      en: "Brings Spotify to the front and toggles playback. Space is Spotify's play/pause shortcut on both Windows and macOS while its window is focused, so this needs no platform-specific key.",
      ru: 'Разворачивает Spotify и переключает воспроизведение. Space — сочетание play/pause у Spotify и на Windows, и на macOS, пока окно активно, так что платформенная клавиша тут не нужна.',
    },
    triggerPhrases: [
      'play music',
      'pause music',
      'toggle music',
      'включи музыку',
      'поставь музыку',
      'останови музыку',
      'пауза музыки',
    ],
    steps: [
      { kind: 'open', target: 'Spotify' },
      { kind: 'wait', ms: 1500 },
      { kind: 'key', keys: 'space' },
    ],
  },
  {
    id: 'next-track',
    name: { en: 'Next track (Spotify)', ru: 'Следующий трек (Spotify)' },
    description: {
      en: 'Skips to the next song. Assumes Spotify is already open — add an "Open" step of your own first if you\'d rather this scenario launch it too.',
      ru: 'Переключает на следующую песню. Предполагается, что Spotify уже открыт — добавьте свой шаг «Открыть» в начало, если хотите, чтобы сценарий сам запускал приложение.',
    },
    triggerPhrases: [
      'next track',
      'next song',
      'skip song',
      'skip track',
      'следующий трек',
      'следующая песня',
      'переключи трек',
    ],
    steps: [{ kind: 'key', keys: '{mod}+right' }],
  },
  {
    id: 'previous-track',
    name: { en: 'Previous track (Spotify)', ru: 'Предыдущий трек (Spotify)' },
    description: {
      en: 'Goes back to the previous song. Same assumption as "Next track" — Spotify already open.',
      ru: 'Возвращает на предыдущую песню. То же допущение, что и у «Следующий трек» — Spotify уже открыт.',
    },
    triggerPhrases: [
      'previous track',
      'previous song',
      'last track',
      'предыдущий трек',
      'предыдущая песня',
      'прошлый трек',
    ],
    steps: [{ kind: 'key', keys: '{mod}+left' }],
  },
  {
    id: 'volume-up',
    name: { en: 'Volume up (Spotify)', ru: 'Громче (Spotify)' },
    description: {
      en: "Raises Spotify's own playback volume — not the system volume. Assumes Spotify is already open and focused.",
      ru: 'Увеличивает громкость воспроизведения именно в Spotify — не системную громкость. Предполагается, что Spotify уже открыт и активен.',
    },
    triggerPhrases: [
      'volume up',
      'louder',
      'turn it up',
      'громче',
      'сделай громче',
      'прибавь звук',
    ],
    steps: [{ kind: 'key', keys: '{mod}+up' }],
  },
  {
    id: 'volume-down',
    name: { en: 'Volume down (Spotify)', ru: 'Тише (Spotify)' },
    description: {
      en: "Lowers Spotify's own playback volume — not the system volume. Assumes Spotify is already open and focused.",
      ru: 'Уменьшает громкость воспроизведения именно в Spotify — не системную громкость. Предполагается, что Spotify уже открыт и активен.',
    },
    triggerPhrases: ['volume down', 'quieter', 'turn it down', 'тише', 'сделай тише', 'убавь звук'],
    steps: [{ kind: 'key', keys: '{mod}+down' }],
  },
  {
    id: 'show-weather',
    name: { en: 'Show weather', ru: 'Показать погоду' },
    description: {
      en: 'Opens a plain-text weather report for your location in the browser — no account, app or API key needed.',
      ru: 'Открывает в браузере текстовый прогноз погоды для вашего местоположения — без аккаунта, приложения или API-ключа.',
    },
    triggerPhrases: [
      'show weather',
      "what's the weather",
      'weather forecast',
      'check the weather',
      'покажи погоду',
      'какая погода',
      'прогноз погоды',
      'узнай погоду',
    ],
    steps: [{ kind: 'open', target: 'https://wttr.in' }],
  },
]

/** Resolves the `{mod}` placeholder in a preset's 'key' steps to the current OS's modifier — 'cmd' on macOS, 'ctrl' elsewhere. Pure so it's testable without Electron. */
export function resolvePresetSteps(steps: ScenarioStep[], platform: string): ScenarioStep[] {
  const mod = platform === 'darwin' ? 'cmd' : 'ctrl'
  return steps.map((s) =>
    s.kind === 'key' && s.keys?.includes('{mod}')
      ? { ...s, keys: s.keys.replace('{mod}', mod) }
      : s,
  )
}
