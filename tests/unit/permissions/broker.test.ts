import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanUseTool, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import {
  PermissionBroker,
  toQuestionItems,
  type AskInput,
  type BrokerDeps,
  type BrokerUi,
  type PolicyDecision,
} from '../../../src/main/agent/permissions/broker'
import type { PermissionRequest, QuestionRequest } from '../../../src/shared/events'

function makeUi(): BrokerUi & {
  requestPermission: ReturnType<typeof vi.fn<(req: PermissionRequest) => void>>
  resolvePermission: ReturnType<typeof vi.fn<(requestId: string) => void>>
  requestQuestion: ReturnType<typeof vi.fn<(req: QuestionRequest) => void>>
  resolveQuestion: ReturnType<typeof vi.fn<(requestId: string) => void>>
} {
  return {
    requestPermission: vi.fn(),
    resolvePermission: vi.fn(),
    requestQuestion: vi.fn(),
    resolveQuestion: vi.fn(),
  }
}

function askDecision(over: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    verdict: 'ask',
    category: 'edit',
    dangerous: false,
    dangerReasons: [],
    canAlwaysAllow: true,
    ...over,
  }
}

function askInput(over: Partial<AskInput> = {}): AskInput {
  return {
    toolName: 'Bash',
    input: {},
    category: 'exec',
    dangerous: false,
    dangerReasons: [],
    canAlwaysAllow: true,
    suggestionsCount: 0,
    ...over,
  }
}

function ctx(over: Partial<Parameters<CanUseTool>[2]> = {}): Parameters<CanUseTool>[2] {
  return {
    signal: new AbortController().signal,
    toolUseID: 'tool-use-1',
    requestId: 'control-req-1',
    ...over,
  }
}

describe('toQuestionItems', () => {
  it('maps raw questions and defaults missing options to an empty array', () => {
    expect(
      toQuestionItems([
        {
          question: 'Which color?',
          header: 'Color',
          multiSelect: true,
          options: [{ label: 'Red' }],
        },
        { question: 'Proceed?' },
      ]),
    ).toEqual([
      {
        question: 'Which color?',
        header: 'Color',
        multiSelect: true,
        options: [{ label: 'Red', description: undefined }],
      },
      { question: 'Proceed?', header: undefined, multiSelect: undefined, options: [] },
    ])
  })
})

describe('PermissionBroker.ask', () => {
  let ui: ReturnType<typeof makeUi>
  let broker: PermissionBroker

  beforeEach(() => {
    vi.useFakeTimers()
    ui = makeUi()
    broker = new PermissionBroker({ ui, policy: () => askDecision() })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves deny immediately without prompting when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await broker.ask(askInput(), controller.signal)
    expect(result).toBe('deny')
    expect(ui.requestPermission).not.toHaveBeenCalled()
  })

  it('shows the prompt with a generated requestId and resolves via respond()', async () => {
    const promise = broker.ask(askInput({ input: { command: 'ls' } }))
    expect(ui.requestPermission).toHaveBeenCalledTimes(1)
    const req = ui.requestPermission.mock.calls[0]![0]
    expect(req.toolName).toBe('Bash')
    expect(typeof req.requestId).toBe('string')
    broker.respond(req.requestId, 'allow')
    await expect(promise).resolves.toBe('allow')
    expect(ui.resolvePermission).toHaveBeenCalledWith(req.requestId)
  })

  it('denies after the default 5-minute timeout with no response', async () => {
    const promise = broker.ask(askInput())
    vi.advanceTimersByTime(5 * 60_000)
    await expect(promise).resolves.toBe('deny')
  })

  it('uses a custom timeoutMs when configured', async () => {
    broker = new PermissionBroker({ ui, policy: () => askDecision(), timeoutMs: 1_000 })
    const promise = broker.ask(askInput())
    vi.advanceTimersByTime(999)
    vi.advanceTimersByTime(1)
    await expect(promise).resolves.toBe('deny')
  })

  it('denies when the signal aborts after the prompt is already shown', async () => {
    const controller = new AbortController()
    const promise = broker.ask(askInput(), controller.signal)
    controller.abort()
    await expect(promise).resolves.toBe('deny')
  })

  it('respond() for an unknown or already-settled requestId is a harmless no-op', () => {
    expect(() => broker.respond('does-not-exist', 'allow')).not.toThrow()
  })
})

describe('PermissionBroker.applyDecision', () => {
  const rules = [{ toolName: 'Bash' }]

  it('grants turn-wide allow only for allow + the input category', () => {
    const onTurnAllow = vi.fn()
    const broker = new PermissionBroker({ ui: makeUi(), policy: () => askDecision(), onTurnAllow })
    broker.applyDecision('allow', 'Bash', {}, 'input', rules)
    expect(onTurnAllow).toHaveBeenCalledWith('input')
    onTurnAllow.mockClear()
    broker.applyDecision('allow', 'Bash', {}, 'edit', rules)
    expect(onTurnAllow).not.toHaveBeenCalled()
  })

  it('calls onSessionAllow for allow-session', () => {
    const onSessionAllow = vi.fn()
    const broker = new PermissionBroker({
      ui: makeUi(),
      policy: () => askDecision(),
      onSessionAllow,
    })
    broker.applyDecision('allow-session', 'Bash', {}, 'exec', rules)
    expect(onSessionAllow).toHaveBeenCalledWith('exec')
  })

  it('calls onAlwaysAllow with the rules for allow-always', () => {
    const onAlwaysAllow = vi.fn()
    const broker = new PermissionBroker({
      ui: makeUi(),
      policy: () => askDecision(),
      onAlwaysAllow,
    })
    broker.applyDecision('allow-always', 'Bash', {}, 'edit', rules)
    expect(onAlwaysAllow).toHaveBeenCalledWith(rules)
  })

  it('calls none of the hooks on deny', () => {
    const onTurnAllow = vi.fn()
    const onSessionAllow = vi.fn()
    const onAlwaysAllow = vi.fn()
    const broker = new PermissionBroker({
      ui: makeUi(),
      policy: () => askDecision(),
      onTurnAllow,
      onSessionAllow,
      onAlwaysAllow,
    })
    broker.applyDecision('deny', 'Bash', {}, 'edit', rules)
    expect(onTurnAllow).not.toHaveBeenCalled()
    expect(onSessionAllow).not.toHaveBeenCalled()
    expect(onAlwaysAllow).not.toHaveBeenCalled()
  })
})

describe('PermissionBroker onDecision (SEC-03)', () => {
  it('fires from decide() for an immediate allow/deny verdict that carries a reason, not for ask', () => {
    const onDecision = vi.fn()
    const broker = new PermissionBroker({
      ui: makeUi(),
      policy: () => askDecision({ verdict: 'allow', reason: 'auto-category' }),
      onDecision,
    })
    broker.decide('Read', { path: '/x' })
    expect(onDecision).toHaveBeenCalledWith({
      toolName: 'Read',
      input: { path: '/x' },
      verdict: 'allow',
      reason: 'auto-category',
    })
  })

  it('does not fire from decide() for an ask verdict (not a final decision yet)', () => {
    const onDecision = vi.fn()
    const broker = new PermissionBroker({
      ui: makeUi(),
      policy: () => askDecision(),
      onDecision,
    })
    broker.decide('Bash', { command: 'ls' })
    expect(onDecision).not.toHaveBeenCalled()
  })

  it('fires from applyDecision() for each dialog outcome, mapped to its own reason', () => {
    const onDecision = vi.fn()
    const broker = new PermissionBroker({ ui: makeUi(), policy: () => askDecision(), onDecision })
    broker.applyDecision('allow', 'Bash', { command: 'ls' }, 'exec', [])
    broker.applyDecision('allow-session', 'Bash', {}, 'exec', [])
    broker.applyDecision('allow-always', 'Bash', {}, 'exec', [{ toolName: 'Bash' }])
    broker.applyDecision('deny', 'Bash', {}, 'exec', [])
    expect(onDecision.mock.calls.map((c) => c[0])).toEqual([
      { toolName: 'Bash', input: { command: 'ls' }, verdict: 'allow', reason: 'dialog-allow' },
      { toolName: 'Bash', input: {}, verdict: 'allow', reason: 'dialog-allow-session' },
      { toolName: 'Bash', input: {}, verdict: 'allow', reason: 'dialog-allow-always' },
      { toolName: 'Bash', input: {}, verdict: 'deny', reason: 'dialog-deny' },
    ])
  })
})

describe('PermissionBroker.canUseTool', () => {
  let ui: ReturnType<typeof makeUi>

  beforeEach(() => {
    ui = makeUi()
  })

  function makeBroker(
    policyResult: PolicyDecision,
    extra: Partial<BrokerDeps> = {},
  ): PermissionBroker {
    return new PermissionBroker({ ui, policy: () => policyResult, ...extra })
  }

  it('allows immediately on an allow verdict, without ever prompting', async () => {
    const broker = makeBroker(askDecision({ verdict: 'allow' }))
    const result = await broker.canUseTool('Read', { path: '/x' }, ctx())
    expect(result).toEqual({ behavior: 'allow', updatedInput: { path: '/x' } })
    expect(ui.requestPermission).not.toHaveBeenCalled()
  })

  it('denies immediately on a deny verdict, using the policy message when given', async () => {
    const broker = makeBroker(askDecision({ verdict: 'deny', denyMessage: 'nope' }))
    const result = await broker.canUseTool('Bash', {}, ctx())
    expect(result).toEqual({ behavior: 'deny', message: 'nope' })
  })

  it('falls back to a default deny message when the policy gives none', async () => {
    const broker = makeBroker(askDecision({ verdict: 'deny' }))
    const result = await broker.canUseTool('Bash', {}, ctx())
    expect(result).toEqual({ behavior: 'deny', message: 'Blocked by Vivi policy' })
  })

  it('prompts with the mapped fields, disabling canAlwaysAllow when the action is dangerous', async () => {
    const broker = makeBroker(
      askDecision({
        category: 'exec',
        dangerous: true,
        dangerReasons: ['rm -rf'],
        canAlwaysAllow: true,
      }),
    )
    const promise = broker.canUseTool(
      'Bash',
      { command: 'rm -rf /' },
      ctx({
        title: 'Run rm -rf',
        displayName: 'Run command',
        description: 'desc',
        decisionReason: 'why',
      }),
    )
    const req = ui.requestPermission.mock.calls[0]![0]
    expect(req).toMatchObject({
      toolName: 'Bash',
      title: 'Run rm -rf',
      displayName: 'Run command',
      description: 'desc',
      reason: 'why',
      category: 'exec',
      dangerous: true,
      dangerReasons: ['rm -rf'],
      canAlwaysAllow: false, // dangerous overrides the policy's canAlwaysAllow
      suggestionsCount: 0,
    })
    broker.respond(req.requestId, 'deny')
    await promise
  })

  it('returns user_temporary allow for a plain allow answer', async () => {
    const broker = makeBroker(askDecision())
    const promise = broker.canUseTool('Edit', { path: '/x' }, ctx())
    const req = ui.requestPermission.mock.calls[0]![0]
    broker.respond(req.requestId, 'allow')
    await expect(promise).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { path: '/x' },
      decisionClassification: 'user_temporary',
    })
  })

  it('returns user_permanent allow with updatedPermissions for allow-always, using suggested rules', async () => {
    const suggestion: PermissionUpdate = {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'git *' }],
      behavior: 'allow',
      destination: 'session',
    }
    const broker = makeBroker(askDecision())
    const promise = broker.canUseTool(
      'Bash',
      { command: 'git status' },
      ctx({ suggestions: [suggestion] }),
    )
    const req = ui.requestPermission.mock.calls[0]![0]
    broker.respond(req.requestId, 'allow-always')
    const result = await promise
    expect(result).toMatchObject({
      behavior: 'allow',
      updatedInput: { command: 'git status' },
      decisionClassification: 'user_permanent',
      updatedPermissions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'git *' }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    })
  })

  it('falls back to a bare {toolName} rule for allow-always when there are no addRules suggestions', async () => {
    const broker = makeBroker(askDecision())
    const promise = broker.canUseTool('Bash', {}, ctx())
    const req = ui.requestPermission.mock.calls[0]![0]
    broker.respond(req.requestId, 'allow-always')
    const result = await promise
    expect(result).toMatchObject({
      updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow' }],
    })
  })

  it('denies with user_reject for a deny answer', async () => {
    const broker = makeBroker(askDecision())
    const promise = broker.canUseTool('Bash', {}, ctx())
    const req = ui.requestPermission.mock.calls[0]![0]
    broker.respond(req.requestId, 'deny')
    await expect(promise).resolves.toEqual({
      behavior: 'deny',
      message: 'The user denied this action.',
      decisionClassification: 'user_reject',
    })
  })

  it('routes AskUserQuestion to the question dialog instead of the normal ask flow', async () => {
    const broker = makeBroker(askDecision())
    const promise = broker.canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }] },
      ctx(),
    )
    expect(ui.requestPermission).not.toHaveBeenCalled()
    expect(ui.requestQuestion).toHaveBeenCalledTimes(1)
    const req = ui.requestQuestion.mock.calls[0]![0]
    broker.answerQuestion(req.requestId, { 'Pick one': 'A' })
    const result = await promise
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { questions: expect.any(Array), answers: { 'Pick one': 'A' } },
    })
  })

  it('denies AskUserQuestion when the answers come back empty (dismissed)', async () => {
    const broker = makeBroker(askDecision())
    const promise = broker.canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'Pick one' }] },
      ctx(),
    )
    const req = ui.requestQuestion.mock.calls[0]![0]
    broker.answerQuestion(req.requestId, {})
    await expect(promise).resolves.toEqual({
      behavior: 'deny',
      message: 'The user dismissed the question.',
    })
  })
})

describe('PermissionBroker.askQuestions', () => {
  let ui: ReturnType<typeof makeUi>
  let broker: PermissionBroker

  beforeEach(() => {
    ui = makeUi()
    broker = new PermissionBroker({ ui, policy: () => askDecision() })
  })

  it('resolves {} immediately without prompting when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await broker.askQuestions([], controller.signal)
    expect(result).toEqual({})
    expect(ui.requestQuestion).not.toHaveBeenCalled()
  })

  it('resolves with the answers passed to answerQuestion, and notifies the UI', async () => {
    const promise = broker.askQuestions([{ question: 'Q1', options: [] }])
    const req = ui.requestQuestion.mock.calls[0]![0]
    broker.answerQuestion(req.requestId, { Q1: 'yes' })
    await expect(promise).resolves.toEqual({ Q1: 'yes' })
    expect(ui.resolveQuestion).toHaveBeenCalledWith(req.requestId)
  })

  it('resolves {} when the signal aborts after the dialog is already shown', async () => {
    const controller = new AbortController()
    const promise = broker.askQuestions([{ question: 'Q1', options: [] }], controller.signal)
    controller.abort()
    await expect(promise).resolves.toEqual({})
  })

  it('answerQuestion for an unknown or already-settled requestId is a harmless no-op', () => {
    expect(() => broker.answerQuestion('does-not-exist', {})).not.toThrow()
  })
})

describe('PermissionBroker.cancelAll', () => {
  it('denies every pending permission ask and empties every pending question', async () => {
    const ui = makeUi()
    const broker = new PermissionBroker({ ui, policy: () => askDecision() })
    const p1 = broker.ask(askInput())
    const p2 = broker.ask(askInput({ toolName: 'Edit', category: 'edit' }))
    const q1 = broker.askQuestions([{ question: 'Q', options: [] }])
    broker.cancelAll()
    await expect(p1).resolves.toBe('deny')
    await expect(p2).resolves.toBe('deny')
    await expect(q1).resolves.toEqual({})
  })
})
