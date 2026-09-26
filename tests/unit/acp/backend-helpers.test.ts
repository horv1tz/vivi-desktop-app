import { describe, expect, it } from 'vitest'
import { RequestError } from '@agentclientprotocol/sdk'
import { alwaysAllowRuleFor, answersToFormContent, formToQuestions, mapAcpError, selectPermissionOption } from '@main/agent/acp-backend'
import { splitArgs } from '@main/agent/acp/args'

describe('splitArgs', () => {
  it('splits on whitespace and honours quotes and escapes', () => {
    expect(splitArgs('')).toEqual([])
    expect(splitArgs('  --model  claude-sonnet-5 ')).toEqual(['--model', 'claude-sonnet-5'])
    expect(splitArgs(`--name "John Doe" --path 'C:\\Program Files\\x' a\\ b ""`)).toEqual(['--name', 'John Doe', '--path', 'C:\\Program Files\\x', 'a b', ''])
  })
})

describe('selectPermissionOption', () => {
  const options = [
    { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' as const },
    { optionId: 'allow-with-updates', name: 'Always', kind: 'allow_always' as const },
    { optionId: 'reject', name: 'No', kind: 'reject_once' as const },
  ]
  it('maps decisions to option kinds with sensible fallbacks', () => {
    expect(selectPermissionOption(options, 'allow')?.optionId).toBe('allow-once')
    expect(selectPermissionOption(options, 'allow-always')?.optionId).toBe('allow-with-updates')
    expect(selectPermissionOption(options, 'deny')?.optionId).toBe('reject')
    expect(selectPermissionOption(options.filter((o) => o.kind !== 'allow_always'), 'allow-always')?.optionId).toBe('allow-once')
    expect(selectPermissionOption([], 'allow')).toBeUndefined()
  })
})

describe('alwaysAllowRuleFor', () => {
  it('narrows Bash always-allow rules to the command prefix', () => {
    expect(alwaysAllowRuleFor('Bash', { command: 'git status --short' })).toEqual({ toolName: 'Bash', ruleContent: 'git:*' })
    expect(alwaysAllowRuleFor('Bash', { command: '$(evil) x' })).toEqual({ toolName: 'Bash' })
    expect(alwaysAllowRuleFor('Read', { file_path: '/x' })).toEqual({ toolName: 'Read' })
  })
})

describe('mapAcpError', () => {
  it('classifies auth, rate limit and startup errors', () => {
    expect(mapAcpError(RequestError.authRequired()).code).toBe('authentication_failed')
    expect(mapAcpError(new Error('Rate limit exceeded')).code).toBe('rate_limit')
    expect(mapAcpError(new Error('ACP initialize timed out after 30s')).code).toBe('startup_failed')
    expect(mapAcpError(new Error('spawn foo ENOENT')).code).toBe('startup_failed')
    expect(mapAcpError(new Error('weird')).code).toBe('unknown')
  })
})

describe('form elicitation ⇄ question dialog', () => {
  const request = {
    mode: 'form' as const,
    sessionId: 's',
    message: 'Which database?',
    requestedSchema: {
      type: 'object' as const,
      properties: {
        question_0: { type: 'string', title: 'DB', oneOf: [{ const: 'Postgres', title: 'Postgres', description: 'relational' }, { const: 'Redis', title: 'Redis' }] },
        question_0_custom: { type: 'string', title: 'Other', _meta: { 'claude-code': { questionId: 'question_0', isCustomAnswer: true } } },
        question_1: { type: 'array', title: 'Features', description: 'Pick features', items: { anyOf: [{ const: 'auth', title: 'auth' }, { const: 'cache', title: 'cache' }] } },
      },
    },
  }

  it('turns AskUserQuestion forms into question items (custom fields hidden)', () => {
    const { questions, fields } = formToQuestions(request as never)
    expect(questions).toEqual([
      { question: 'Which database?', header: 'DB', multiSelect: false, options: [{ label: 'Postgres', description: 'relational' }, { label: 'Redis', description: undefined }] },
      { question: 'Pick features', header: 'Features', multiSelect: true, options: [{ label: 'auth', description: undefined }, { label: 'cache', description: undefined }] },
    ])
    expect(fields.map((f) => f.key)).toEqual(['question_0', 'question_1'])
    expect(fields[0]!.customKey).toBe('question_0_custom')
  })

  it('folds dialog answers back into form content, routing free text to the custom field', () => {
    const { questions, fields } = formToQuestions(request as never)
    const content = answersToFormContent({ 'Which database?': 'Postgres, but hosted', 'Pick features': 'auth, cache, metrics' }, questions, fields)
    expect(content).toEqual({ question_0: 'Postgres', question_0_custom: 'but hosted', question_1: ['auth', 'cache', 'metrics'] })
  })

  it('returns no questions for non-form elicitations', () => {
    expect(formToQuestions({ mode: 'url', sessionId: 's', message: 'x', url: 'https://x' } as never).questions).toEqual([])
  })
})
