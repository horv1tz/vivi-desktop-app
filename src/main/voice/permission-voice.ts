import type { PermissionDecision, PermissionRequest, QuestionRequest } from '@shared/events'

export type VoiceLocale = 'ru' | 'en'

/**
 * VO-05: a small, fixed grammar for answering a permission/question prompt by voice — no model
 * call, just keyword matching, so it works even while the agent turn that raised the prompt is
 * still "thinking" and stays fast/predictable for a yes-or-no decision.
 *
 * Tokenizes with \p{L} (Unicode "letter") instead of \b-delimited word regexes: \b is defined in
 * terms of ASCII word characters, so it doesn't fire at all around Cyrillic text and silently
 * fails to match "нет"/"да" as whole words.
 */
function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
}

const ALLOW_ALWAYS_PHRASES = ['always allow', 'allow always', 'разреши всегда']
const ALLOW_ALWAYS_WORDS = ['always', 'всегда']
const DENY_PHRASES = ["don't", 'do not']
const DENY_WORDS = [
  'no',
  'nope',
  'nah',
  'deny',
  'cancel',
  'stop',
  'нет',
  'неа',
  'отмена',
  'отменить',
  'отклони',
  'запрети',
]
const ALLOW_PHRASES = ['go ahead', 'do it']
const ALLOW_WORDS = [
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
  'allow',
  'ok',
  'okay',
  'да',
  'ага',
  'конечно',
  'разрешаю',
  'разреши',
  'давай',
]

function matchesAny(text: string, tokens: string[], phrases: string[], words: string[]): boolean {
  return phrases.some((p) => text.includes(p)) || words.some((w) => tokens.includes(w))
}

/** Returns null when the transcript doesn't look like an answer to a permission prompt at all. */
export function matchPermissionAnswer(transcript: string): PermissionDecision | null {
  const t = transcript.trim().toLowerCase()
  if (!t) return null
  const tokens = tokenize(t)
  if (matchesAny(t, tokens, ALLOW_ALWAYS_PHRASES, ALLOW_ALWAYS_WORDS)) return 'allow-always'
  if (matchesAny(t, tokens, DENY_PHRASES, DENY_WORDS)) return 'deny'
  if (matchesAny(t, tokens, ALLOW_PHRASES, ALLOW_WORDS)) return 'allow'
  return null
}

const ORDINAL_EN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
const ORDINAL_RU_STEM = ['перв', 'втор', 'трет', 'четверт', 'пят', 'шест']

/**
 * Matches a spoken reply against one question's options by number ("2", "option 2", "second",
 * "второй"), by a content word from the option's own label (skipping short filler words like
 * "use"/"the" so all-options-share-a-prefix labels don't collide), or a direct substring/superset
 * match. Returns the option's label (the value the broker expects in its `answers` map), or null.
 */
export function matchQuestionOption(
  transcript: string,
  options: { label: string }[],
): string | null {
  const t = transcript.trim().toLowerCase()
  if (!t || options.length === 0) return null
  const tokens = tokenize(t)
  for (let i = 0; i < options.length; i++) {
    const n = i + 1
    if (
      t.includes(`option ${n}`) ||
      t.includes(`вариант ${n}`) ||
      t.includes(`№${n}`) ||
      tokens.includes(String(n))
    )
      return options[i]!.label
    if (ORDINAL_EN[i] && tokens.includes(ORDINAL_EN[i]!)) return options[i]!.label
    const ruStem = ORDINAL_RU_STEM[i]
    if (ruStem && tokens.some((w) => w.startsWith(ruStem))) return options[i]!.label
  }
  for (const o of options) {
    const label = o.label.trim().toLowerCase()
    if (label.length >= 3 && (t.includes(label) || label.includes(t))) return o.label
    const contentWords = tokenize(label).filter((w) => w.length >= 4)
    if (contentWords.some((w) => tokens.includes(w))) return o.label
  }
  return null
}

/** Spoken description of a permission prompt. Kept short — this is read aloud, not displayed. */
export function describePermissionPrompt(
  req: PermissionRequest,
  locale: VoiceLocale = 'en',
): string {
  const what = req.displayName || req.title || req.toolName
  if (locale === 'ru') {
    const risk = req.dangerous ? ' Это может быть рискованно.' : ''
    return `Виви хочет: ${what}.${risk} Скажите да, нет, или всегда разрешай.`
  }
  const risk = req.dangerous ? ' This looks potentially risky.' : ''
  return `Vivi wants to: ${what}.${risk} Say yes, no, or always allow.`
}

/**
 * Null return means "don't attempt voice Q&A for this one" — kept to the common case (one
 * single-select question) since a reliable spoken grammar for multi-question or multi-select
 * prompts (comma-separated lists, "the first and the third", …) is a lot more failure-prone than
 * it's worth; those still show the on-screen dialog as before.
 */
export function describeQuestionPrompt(
  req: QuestionRequest,
  locale: VoiceLocale = 'en',
): string | null {
  if (req.questions.length !== 1) return null
  const q = req.questions[0]!
  if (q.multiSelect || q.options.length === 0) return null
  const options = q.options.map((o, i) => `${i + 1}. ${o.label}`).join(', ')
  if (locale === 'ru') return `Виви спрашивает: ${q.question} Варианты: ${options}.`
  return `Vivi is asking: ${q.question} Options: ${options}.`
}

export function permissionDeniedSpoken(locale: VoiceLocale = 'en'): string {
  return locale === 'ru' ? 'Отклонено.' : 'Denied.'
}
export function permissionAllowedSpoken(locale: VoiceLocale = 'en'): string {
  return locale === 'ru' ? 'Разрешено.' : 'Got it.'
}
export function permissionRetrySpoken(locale: VoiceLocale = 'en'): string {
  return locale === 'ru'
    ? 'Не расслышала. Скажите да, нет, или всегда разрешай.'
    : 'Sorry, please say yes, no, or always allow.'
}
export function questionAnsweredSpoken(label: string, locale: VoiceLocale = 'en'): string {
  return locale === 'ru' ? `Принято: ${label}.` : `Got it: ${label}.`
}
export function questionRetrySpoken(locale: VoiceLocale = 'en'): string {
  return locale === 'ru'
    ? 'Не поняла вариант. Повторите, пожалуйста.'
    : "Sorry, I didn't catch that option. Could you repeat it?"
}
