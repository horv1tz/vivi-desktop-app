import { randomUUID } from 'node:crypto'
import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionCategory, PermissionDecision, PermissionRequest, QuestionRequest } from '@shared/events'

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

interface Pending {
  resolve: (decision: PermissionDecision) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Bridges the SDK's canUseTool callback to the UI: applies the policy engine first, then asks
 * the user for anything left over. AskUserQuestion is routed to the question dialog.
 */
export class PermissionBroker {
  private pending = new Map<string, Pending>()
  private pendingQuestions = new Map<string, (answers: Record<string, string>) => void>()

  constructor(private readonly deps: BrokerDeps) {}

  readonly canUseTool: CanUseTool = async (toolName, input, ctx) => {
    if (toolName === 'AskUserQuestion') return this.askQuestion(input, ctx.signal)
    const decision = this.deps.policy(toolName, input)
    if (decision.verdict === 'allow') return { behavior: 'allow', updatedInput: input }
    if (decision.verdict === 'deny') return { behavior: 'deny', message: decision.denyMessage ?? 'Blocked by Vivi policy' }

    const requestId = randomUUID()
    const answer = await new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => this.settle(requestId, 'deny'), this.deps.timeoutMs ?? 5 * 60_000)
      this.pending.set(requestId, { resolve, timer })
      const onAbort = (): void => this.settle(requestId, 'deny')
      ctx.signal.addEventListener('abort', onAbort, { once: true })
      this.deps.ui.requestPermission({
        requestId,
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
      })
    })
    this.deps.ui.resolvePermission(requestId)

    switch (answer) {
      case 'allow':
        if (decision.category === 'input') this.deps.onTurnAllow?.('input')
        return { behavior: 'allow', updatedInput: input, decisionClassification: 'user_temporary' }
      case 'allow-session':
        this.deps.onSessionAllow?.(decision.category)
        return { behavior: 'allow', updatedInput: input, decisionClassification: 'user_temporary' }
      case 'allow-always': {
        const suggestions = (ctx.suggestions ?? []).filter((s): s is Extract<PermissionUpdate, { type: 'addRules' }> => s.type === 'addRules' && s.behavior === 'allow')
        const rules = suggestions.length ? suggestions.flatMap((s) => s.rules) : [{ toolName }]
        this.deps.onAlwaysAllow?.(rules)
        const updatedPermissions: PermissionUpdate[] = [{ type: 'addRules', rules, behavior: 'allow', destination: 'session' }]
        return { behavior: 'allow', updatedInput: input, updatedPermissions, decisionClassification: 'user_permanent' }
      }
      default:
        return { behavior: 'deny', message: 'The user denied this action.', decisionClassification: 'user_reject' }
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

  private async askQuestion(input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
    const raw = (input.questions as { question: string; header?: string; multiSelect?: boolean; options?: { label: string; description?: string }[] }[] | undefined) ?? []
    const requestId = randomUUID()
    const answers = await new Promise<Record<string, string>>((resolve) => {
      this.pendingQuestions.set(requestId, resolve)
      signal.addEventListener('abort', () => this.answerQuestion(requestId, {}), { once: true })
      this.deps.ui.requestQuestion({
        requestId,
        questions: raw.map((q) => ({ question: q.question, header: q.header, multiSelect: q.multiSelect, options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description })) })),
      })
    })
    if (Object.keys(answers).length === 0) return { behavior: 'deny', message: 'The user dismissed the question.' }
    return { behavior: 'allow', updatedInput: { ...input, answers } }
  }

  /** Deny everything still pending (used on dispose). */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, 'deny')
    for (const id of [...this.pendingQuestions.keys()]) this.answerQuestion(id, {})
  }
}
