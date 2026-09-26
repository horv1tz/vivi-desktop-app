import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissionStore } from '../../stores/permissions'
import { Modal } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { cn } from '../../lib/cn'

export function QuestionDialog() {
  const { t } = useTranslation()
  const questions = usePermissionStore((s) => s.questions)
  const answer = usePermissionStore((s) => s.answer)
  const req = questions[0]
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  if (!req) return null

  const toggle = (q: string, label: string, multi: boolean): void => {
    setAnswers((prev) => {
      const cur = prev[q] ?? []
      if (multi)
        return {
          ...prev,
          [q]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label],
        }
      return { ...prev, [q]: [label] }
    })
  }

  const submit = (): void => {
    const out: Record<string, string> = {}
    for (const q of req.questions) {
      const chosen = answers[q.question] ?? []
      const extra = other[q.question]?.trim()
      out[q.question] = [...chosen, ...(extra ? [extra] : [])].join(', ')
    }
    setAnswers({})
    setOther({})
    void answer(req.requestId, out)
  }

  return (
    <Modal open title={t('question.title')} dismissable={false}>
      <div className="flex flex-col gap-5">
        {req.questions.map((q) => (
          <div key={q.question}>
            {q.header ? (
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
                {q.header}
              </div>
            ) : null}
            <div className="mb-2 text-sm font-medium">{q.question}</div>
            <div className="flex flex-wrap gap-2">
              {q.options.map((o) => {
                const active = (answers[q.question] ?? []).includes(o.label)
                return (
                  <button
                    key={o.label}
                    title={o.description}
                    onClick={() => toggle(q.question, o.label, !!q.multiSelect)}
                    className={cn(
                      'rounded-xl border px-3 py-1.5 text-left text-sm transition-colors',
                      active
                        ? 'border-accent bg-accent/15 text-fg'
                        : 'border-line bg-sunken text-muted hover:text-fg',
                    )}
                  >
                    <div>{o.label}</div>
                    {o.description ? (
                      <div className="text-[11px] text-faint">{o.description}</div>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <Input
              className="mt-2"
              placeholder={t('question.otherPlaceholder')}
              value={other[q.question] ?? ''}
              onChange={(e) => setOther({ ...other, [q.question]: e.target.value })}
            />
          </div>
        ))}
        <div className="flex justify-end">
          <Button variant="primary" onClick={submit}>
            {t('question.submit')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
