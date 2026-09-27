import { describe, expect, it } from 'vitest'
import {
  describePermissionPrompt,
  describeQuestionPrompt,
  matchPermissionAnswer,
  matchQuestionOption,
} from '../../../src/main/voice/permission-voice'
import type { PermissionRequest, QuestionRequest } from '../../../src/shared/events'

const permissionReq = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  requestId: 'r1',
  toolName: 'Bash',
  input: {},
  category: 'exec',
  dangerous: false,
  dangerReasons: [],
  canAlwaysAllow: true,
  suggestionsCount: 0,
  ...overrides,
})

describe('matchPermissionAnswer', () => {
  it('recognizes "always allow" before plain allow/deny words', () => {
    expect(matchPermissionAnswer('always allow')).toBe('allow-always')
    expect(matchPermissionAnswer('всегда разрешай')).toBe('allow-always')
  })

  it('recognizes deny in English and Russian', () => {
    expect(matchPermissionAnswer('no')).toBe('deny')
    expect(matchPermissionAnswer("no, don't")).toBe('deny')
    expect(matchPermissionAnswer('нет')).toBe('deny')
    expect(matchPermissionAnswer('отклони')).toBe('deny')
  })

  it('recognizes allow in English and Russian', () => {
    expect(matchPermissionAnswer('yes')).toBe('allow')
    expect(matchPermissionAnswer('sure, go ahead')).toBe('allow')
    expect(matchPermissionAnswer('да')).toBe('allow')
    expect(matchPermissionAnswer('разрешаю')).toBe('allow')
  })

  it('returns null for unrelated speech', () => {
    expect(matchPermissionAnswer('what time is it')).toBeNull()
    expect(matchPermissionAnswer('')).toBeNull()
  })
})

describe('matchQuestionOption', () => {
  const options = [{ label: 'Use TypeScript' }, { label: 'Use Python' }, { label: 'Use Go' }]

  it('matches by number', () => {
    expect(matchQuestionOption('2', options)).toBe('Use Python')
    expect(matchQuestionOption('option 3', options)).toBe('Use Go')
  })

  it('matches by ordinal word, English and Russian', () => {
    expect(matchQuestionOption('the second one', options)).toBe('Use Python')
    expect(matchQuestionOption('первый вариант', options)).toBe('Use TypeScript')
  })

  it('matches by label substring', () => {
    expect(matchQuestionOption('python please', options)).toBe('Use Python')
  })

  it('returns null when nothing matches', () => {
    expect(matchQuestionOption('purple elephant', options)).toBeNull()
  })
})

describe('describePermissionPrompt', () => {
  it('flags dangerous requests', () => {
    const spoken = describePermissionPrompt(permissionReq({ dangerous: true, toolName: 'Bash' }))
    expect(spoken).toContain('risky')
    expect(spoken).toContain('yes, no, or always allow')
  })

  it('prefers displayName/title over the raw tool name', () => {
    expect(describePermissionPrompt(permissionReq({ displayName: 'run git push' }))).toContain(
      'run git push',
    )
  })

  it('speaks Russian when asked', () => {
    const spoken = describePermissionPrompt(permissionReq({ displayName: 'запустить тесты' }), 'ru')
    expect(spoken).toContain('запустить тесты')
    expect(spoken).toContain('да, нет, или всегда разрешай')
  })
})

describe('describeQuestionPrompt', () => {
  const req = (overrides: Partial<QuestionRequest> = {}): QuestionRequest => ({
    requestId: 'q1',
    questions: [{ question: 'Which language?', options: [{ label: 'TS' }, { label: 'Python' }] }],
    ...overrides,
  })

  it('reads a single-select question with numbered options', () => {
    const spoken = describeQuestionPrompt(req())
    expect(spoken).toContain('Which language?')
    expect(spoken).toContain('1. TS')
    expect(spoken).toContain('2. Python')
  })

  it('speaks Russian when asked', () => {
    const spoken = describeQuestionPrompt(req(), 'ru')
    expect(spoken).toContain('Виви спрашивает')
    expect(spoken).toContain('Варианты')
  })

  it('declines multi-question prompts', () => {
    expect(
      describeQuestionPrompt(
        req({
          questions: [
            { question: 'A?', options: [{ label: 'x' }] },
            { question: 'B?', options: [{ label: 'y' }] },
          ],
        }),
      ),
    ).toBeNull()
  })

  it('declines multi-select questions', () => {
    expect(
      describeQuestionPrompt(
        req({
          questions: [{ question: 'Pick some', multiSelect: true, options: [{ label: 'x' }] }],
        }),
      ),
    ).toBeNull()
  })
})
