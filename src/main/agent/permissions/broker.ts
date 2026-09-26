import { randomUUID } from 'node:crypto'
import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type {
  PermissionCategory,
  PermissionDecision,
  PermissionRequest,
  QuestionItem,
  QuestionRequest,
} from '@shared/events'

export interface BrokerUi {
  requestPermission: (req: PermissionRequest) => void
  resolvePermission: (requestId: string) => void
  requestQuestion: (req: QuestionRequest) => void
  resolveQuestion: (requestId: string) => void
}

export interface PolicyDecision {
  /** Decide without asking: 'allow' | 'deny' | 'ask'. */
  verdict: 'allow' | 'deny' | 'ask'
  category: PermissionCategory
  dangerous: boolean
  dangerReasons: string[]
  canAlwaysAllow: boolean
  denyMessage?: string
}

export interface BrokerDeps {
  ui: BrokerUi
  policy: (toolName: string, input: Record<string, unknown>) => PolicyDecision
  onAlwaysAllow?: (rules: { toolName: string; ruleContent?: string }[]) => void
  onSessionAllow?: (category: PermissionCategory) => void
  /** A plain allow on computer-control tools covers the rest of the turn. */
  onTurnAllow?: (category: PermissionCategory) => void
  timeoutMs?: number
}

/** What the UI needs to render a permission prompt (request id is assigned by the broker). */
export type AskInput = Omit<PermissionRequest, 'requestId'>

interface Pending {
  resolve: (decision: PermissionDecision) => void
  timer: ReturnType<typeof setTimeout>
}

export type RawQuestion = {
  question: string
  header?: string
  multiSelect?: boolean
  options?: { label: string; description?: string }[]
}

export function toQuestionItems(raw: RawQuestion[]): QuestionItem[] {
  return raw.map((q) => ({
    question: q.question,
    header: q.header,
    multiSelect: q.multiSelect,
    options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description })),
  }))
}

/**
 * Bridges tool permission checks to the UI: applies the policy engine first, then asks the user for
 * anything left over. Backend-agnostic: the SDK path uses `canUseTool`, the ACP path uses
 * `decide` + `ask` + `applyDecision` directly. AskUserQuestion is routed to the question dialog.
 */
export class PermissionBroker {
  private pending = new Map<string, Pending>()
  private pendingQuestions = new Map<string, (answers: Record<string, string>) => void>()

  constructor(private readonly deps: BrokerDeps) {}

  /** Policy verdict for a tool call (no UI involved). */
  decide(toolName: string, input: Record<string, unknown>): PolicyDecision {
    return this.deps.policy(toolName, input)
  }

  /** Shows the permission dialog and resolves with the user's decision (deny on timeout/abort). */
  ask(req: AskInput, signal?: AbortSignal): Promise<PermissionDecision> {
    if (signal?.aborted) return Promise.resolve('deny')
    const requestId = randomUUID()
    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(
        () => this.settle(requestId, 'deny'),
        this.deps.timeoutMs ?? 5 * 60_000,
      )
      this.pending.set(requestId, {
        resolve: (d) => {
          this.deps.ui.resolvePermission(requestId)
          resolve(d)
        },
        timer,
      })
      signal?.addEventListener('abort', () => this.settle(requestId, 'deny'), { once: true })
      this.deps.ui.requestPermission({ requestId, ...req })
    })
  }

  /** Records the side effects of a user decision (turn/session grants, persisted always-allow rules). */
  applyDecision(
    answer: PermissionDecision,
    category: PermissionCategory,
    rules: { toolName: string; ruleContent?: string }[],
  ): void {
    if (answer === 'allow' && category === 'input') this.deps.onTurnAllow?.('input')
    if (answer === 'allow-session') this.deps.onSessionAllow?.(category)
    if (answer === 'allow-always') this.deps.onAlwaysAllow?.(rules)
  }

  readonly canUseTool: CanUseTool = async (toolName, input, ctx) => {
    if (toolName === 'AskUserQuestion') return this.askQuestionTool(input, ctx.signal)
    const decision = this.decide(toolName, input)
    if (decision.verdict === 'allow') return { behavior: 'allow', updatedInput: input }
    if (decision.verdict === 'deny')
      return { behavior: 'deny', message: decision.denyMessage ?? 'Blocked by Vivi policy' }

    const answer = await this.ask(
      {
        toolName,
        input,
        title: ctx.title,
        displayName: ctx.displayName,
        description: ctx.description,
        reason: ctx.decisionReason,
        category: decision.category,
        dangerous: decision.dangerous,
        dangerReasons: decision.dangerReasons,
        canAlwaysAllow: decision.canAlwaysAllow && !decision.dangerous,
        suggestionsCount: ctx.suggestions?.length ?? 0,
      },
      ctx.signal,
    )

    const suggestions = (ctx.suggestions ?? []).filter(
      (s): s is Extract<PermissionUpdate, { type: 'addRules' }> =>
        s.type === 'addRules' && s.behavior === 'allow',
    )
    const rules = suggestions.length ? suggestions.flatMap((s) => s.rules) : [{ toolName }]
    this.applyDecision(answer, decision.category, rules)

    switch (answer) {
      case 'allow':
      case 'allow-session':
        return { behavior: 'allow', updatedInput: input, decisionClassification: 'user_temporary' }
      case 'allow-always': {
        const updatedPermissions: PermissionUpdate[] = [
          { type: 'addRules', rules, behavior: 'allow', destination: 'session' },
        ]
        return {
          behavior: 'allow',
          updatedInput: input,
          updatedPermissions,
          decisionClassification: 'user_permanent',
        }
      }
      default:
        return {
          behavior: 'deny',
          message: 'The user denied this action.',
          decisionClassification: 'user_reject',
        }
    }
  }

  private settle(requestId: string, decision: PermissionDecision): void {
    const p = this.pending.get(requestId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(requestId)
    p.resolve(decision)
  }

  respond(requestId: string, decision: PermissionDecision): void {
    this.settle(requestId, decision)
  }

  answerQuestion(requestId: string, answers: Record<string, string>): void {
    const r = this.pendingQuestions.get(requestId)
    if (!r) return
    this.pendingQuestions.delete(requestId)
    r(answers)
    this.deps.ui.resolveQuestion(requestId)
  }

  /** Shows the question dialog; resolves with answers keyed by question text ({} when dismissed/aborted). */
  askQuestions(questions: QuestionItem[], signal?: AbortSignal): Promise<Record<string, string>> {
    if (signal?.aborted) return Promise.resolve({})
    const requestId = randomUUID()
    return new Promise<Record<string, string>>((resolve) => {
      this.pendingQuestions.set(requestId, resolve)
      signal?.addEventListener('abort', () => this.answerQuestion(requestId, {}), { once: true })
      this.deps.ui.requestQuestion({ requestId, questions })
    })
  }

  private async askQuestionTool(
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    const raw = (input.questions as RawQuestion[] | undefined) ?? []
    const answers = await this.askQuestions(toQuestionItems(raw), signal)
    if (Object.keys(answers).length === 0)
      return { behavior: 'deny', message: 'The user dismissed the question.' }
    return { behavior: 'allow', updatedInput: { ...input, answers } }
  }

  /** Deny everything still pending (used on dispose). */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, 'deny')
    for (const id of [...this.pendingQuestions.keys()]) this.answerQuestion(id, {})
  }
}
