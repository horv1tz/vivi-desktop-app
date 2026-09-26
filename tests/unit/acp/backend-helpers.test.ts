import { describe, expect, it } from 'vitest'
import { RequestError } from '@agentclientprotocol/sdk'
import { alwaysAllowRuleFor, answersToFormContent, findAlwaysAllowOption, formToQuestions, mapAcpError, selectPermissionOption } from '@main/agent/acp-backend'
import { splitArgs } from '@main/agent/acp/args'
import { needsWindowsShell, pickWindowsExecutable, quoteForCmd, resolveWindowsCommand } from '@main/agent/acp/process'

describe('splitArgs', () => {
  it('splits on whitespace and honours quotes and escapes (POSIX)', () => {
    expect(splitArgs('', 'linux')).toEqual([])
    expect(splitArgs('  --model  claude-sonnet-5 ', 'linux')).toEqual(['--model', 'claude-sonnet-5'])
    expect(splitArgs(`--name "John Doe" --path 'C:\\Program Files\\x' a\\ b ""`, 'linux')).toEqual(['--name', 'John Doe', '--path', 'C:\\Program Files\\x', 'a b', ''])
  })
  it('keeps backslashes literal on Windows (C runtime rules)', () => {
    expect(splitArgs('--config C:\\Users\\me\\agent.json', 'win32')).toEqual(['--config', 'C:\\Users\\me\\agent.json'])
    expect(splitArgs('"C:\\Program Files\\agent\\run.cmd" --flag', 'win32')).toEqual(['C:\\Program Files\\agent\\run.cmd', '--flag'])
    // CRT quirk: a single backslash before the closing quote escapes it; doubling it keeps the backslash.
    expect(splitArgs('--dir "C:\\tmp\\"', 'win32')).toEqual(['--dir', 'C:\\tmp"'])
    expect(splitArgs('--dir "C:\\tmp\\\\"', 'win32')).toEqual(['--dir', 'C:\\tmp\\'])
    expect(splitArgs('say \\"hi\\"', 'win32')).toEqual(['say', '"hi"'])
    expect(splitArgs("it's", 'win32')).toEqual(["it's"])
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

  it('never treats ExitPlanMode mode-switch options as a generic "always allow"', () => {
    const exitPlan = [
      { optionId: 'exit-plan-clear-auto', name: 'Yes, clear context and use auto mode', kind: 'allow_always' as const },
      { optionId: 'exit-plan-auto', name: 'Yes, and use auto mode', kind: 'allow_always' as const },
      { optionId: 'exit-plan-default', name: 'Yes, manually approve edits', kind: 'allow_once' as const },
      { optionId: 'reject', name: 'No, keep planning', kind: 'reject_once' as const },
    ]
    expect(findAlwaysAllowOption(exitPlan)).toBeUndefined()
    expect(selectPermissionOption(exitPlan, 'allow-always')?.optionId).toBe('exit-plan-default')
    expect(selectPermissionOption(exitPlan, 'allow')?.optionId).toBe('exit-plan-default')
    const webFetch = [
      { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' as const },
      { optionId: 'allow-with-updates', name: "Yes, and don't ask again for example.com", kind: 'allow_always' as const },
      { optionId: 'reject', name: 'No', kind: 'reject_once' as const },
    ]
    expect(findAlwaysAllowOption(webFetch)?.optionId).toBe('allow-with-updates')
  })
})

describe('alwaysAllowRuleFor', () => {
  it('derives only scoped rules and refuses blanket allows', () => {
    expect(alwaysAllowRuleFor('Bash', { command: 'git status --short' })).toEqual({ toolName: 'Bash', ruleContent: 'git:*' })
    expect(alwaysAllowRuleFor('Bash', { command: '$(evil) x' })).toBeNull()
    expect(alwaysAllowRuleFor('Bash', { command: 'sudo rm -rf /' })).toBeNull()
    expect(alwaysAllowRuleFor('WebFetch', { url: 'https://docs.example.com/a?b=1' })).toEqual({ toolName: 'WebFetch', ruleContent: 'domain:docs.example.com' })
    expect(alwaysAllowRuleFor('Read', { file_path: '/x' })).toBeNull()
    expect(alwaysAllowRuleFor('mcp__vivi__mouse', { action: 'click' })).toBeNull()
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

  it('recognises labels that themselves contain a comma', () => {
    const req = { mode: 'form' as const, sessionId: 's', message: 'Pick', requestedSchema: { type: 'object' as const, properties: { q: { type: 'array', items: { anyOf: [{ const: 'a, b', title: 'a, b' }, { const: 'c', title: 'c' }] } } } } }
    const { questions, fields } = formToQuestions(req as never)
    expect(answersToFormContent({ Pick: 'a, b, c, other' }, questions, fields)).toEqual({ q: ['a, b', 'c', 'other'] })
  })

  it('answers with the schema const value when it differs from the label', () => {
    const req = {
      mode: 'form' as const,
      sessionId: 's',
      message: 'Retry with the fallback model?',
      requestedSchema: { type: 'object' as const, properties: { choice: { type: 'string', oneOf: [{ const: 'retry', title: 'Yes, retry with Sonnet' }, { const: 'abort', title: 'No' }] } } },
    }
    const { questions, fields } = formToQuestions(req as never)
    expect(questions[0]!.options.map((o) => o.label)).toEqual(['Yes, retry with Sonnet', 'No'])
    expect(answersToFormContent({ 'Retry with the fallback model?': 'Yes, retry with Sonnet' }, questions, fields)).toEqual({ choice: 'retry' })
  })

  it('returns no questions for non-form elicitations', () => {
    expect(formToQuestions({ mode: 'url', sessionId: 's', message: 'x', url: 'https://x' } as never).questions).toEqual([])
  })
})

describe('windows command handling', () => {
  it('only .cmd/.bat shims need cmd.exe', () => {
    expect(needsWindowsShell('C:\\Users\\me\\AppData\\Roaming\\npm\\gemini.cmd')).toBe(true)
    expect(needsWindowsShell('C:\\tools\\agent.exe')).toBe(false)
    expect(needsWindowsShell('/usr/local/bin/gemini')).toBe(false)
  })
  it('leaves commands untouched off Windows and when they carry a path or extension', () => {
    expect(resolveWindowsCommand('gemini', 'linux')).toBe('gemini')
    expect(resolveWindowsCommand('C:\\x\\agent.exe', 'win32')).toBe('C:\\x\\agent.exe')
    expect(resolveWindowsCommand('.\\agent', 'win32')).toBe('.\\agent')
  })
  it('prefers a real executable or .cmd shim over the extensionless npm sh script', () => {
    const where = ['C:\\Users\\me\\AppData\\Roaming\\npm\\gemini', 'C:\\Users\\me\\AppData\\Roaming\\npm\\gemini.cmd', '']
    expect(pickWindowsExecutable(where)).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\gemini.cmd')
    expect(pickWindowsExecutable(['C:\\a\\x.cmd', 'C:\\b\\x.exe'])).toBe('C:\\b\\x.exe')
    expect(pickWindowsExecutable(['C:\\a\\x'])).toBeUndefined()
    expect(resolveWindowsCommand('gemini', 'win32', () => where)).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\gemini.cmd')
    expect(resolveWindowsCommand('nothing', 'win32', () => [])).toBe('nothing')
  })
  it('quotes cmd.exe arguments only when needed', () => {
    expect(quoteForCmd('--model')).toBe('--model')
    expect(quoteForCmd('C:\\Program Files\\x')).toBe('"C:\\Program Files\\x"')
    expect(quoteForCmd('')).toBe('""')
    expect(quoteForCmd('say "hi"')).toBe('"say \\"hi\\""')
  })
})
