import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import type {
  RoutineEntry,
  RoutineSchedule,
  RoutineScheduleKind,
  ScenarioEntry,
  ScenarioStep,
  ScenarioStepKind,
  SkillEntry,
} from '@shared/events'
import type { Integration } from '@shared/settings'
import { invoke } from '../../lib/bridge'
import { useUiStore } from '../../stores/ui'
import { Field, Input, Section, Select, Textarea } from '../../components/ui/Field'
import { Switch } from '../../components/ui/Switch'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'
import { useSettingsStore } from '../../stores/settings'

type Tab = 'skills' | 'integrations' | 'scenarios' | 'routines'

export function WorkshopView() {
  const { t } = useTranslation()
  const setView = useUiStore((s) => s.setView)
  const [tab, setTab] = useState<Tab>('skills')

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setView('chat')}>
          <ArrowLeft size={16} /> {t('nav.chat')}
        </Button>
        <h2 className="text-xl font-semibold">{t('nav.workshop')}</h2>
        <div className="w-[88px]" />
      </div>
      <div className="flex gap-1 rounded-xl bg-sunken p-1">
        {(['skills', 'integrations', 'scenarios', 'routines'] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={cn(
              'flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors',
              tab === tb ? 'bg-elev text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {t(`settings.skills.tabs.${tb}`)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'skills' ? (
          <SkillsTab />
        ) : tab === 'integrations' ? (
          <IntegrationsTab />
        ) : tab === 'scenarios' ? (
          <ScenariosTab />
        ) : (
          <RoutinesTab />
        )}
      </div>
    </div>
  )
}

function SkillsTab() {
  const { t } = useTranslation()
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [editingId, setEditingId] = useState<string | null | 'new'>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    invoke('skills:list')
      .then(setSkills)
      .catch(() => undefined)
  }, [])
  useEffect(() => refresh(), [refresh])

  const editing = editingId === 'new' ? null : (skills.find((s) => s.id === editingId) ?? null)
  const formOpen = editingId !== null

  return (
    <Section title={t('settings.skills.title')} description={t('settings.skills.description')}>
      {!formOpen ? (
        <Button
          size="sm"
          className="self-start"
          onClick={() => {
            setError(null)
            setEditingId('new')
          }}
        >
          <Plus size={14} /> {t('settings.skills.new')}
        </Button>
      ) : (
        <SkillForm
          initial={editing}
          error={error}
          onCancel={() => {
            setEditingId(null)
            setError(null)
          }}
          onSave={async (input) => {
            const result = editing
              ? await invoke('skills:update', editing.id, input)
              : await invoke('skills:create', input)
            if (result.error) {
              setError(result.error)
              return
            }
            setEditingId(null)
            setError(null)
            refresh()
          }}
        />
      )}
      {skills.length === 0 && !formOpen ? (
        <p className="px-1 py-2 text-sm text-faint">{t('settings.skills.empty')}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {skills.map((s) => (
            <div
              key={s.id}
              data-testid="skill-row"
              className="flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-sm"
            >
              <Switch
                checked={s.enabled}
                onCheckedChange={async (v) => {
                  await invoke('skills:setEnabled', s.id, v)
                  refresh()
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-fg">{s.name}</span>
                  <span className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                    {t(`settings.skills.source.${s.source}`)}
                  </span>
                </div>
                {s.description ? (
                  <div className="text-[12px] text-muted">{s.description}</div>
                ) : null}
              </div>
              <button
                className="shrink-0 rounded-md p-1 text-faint hover:bg-line/60 hover:text-fg"
                title={t('settings.skills.edit')}
                onClick={() => {
                  setError(null)
                  setEditingId(s.id)
                }}
              >
                <Pencil size={14} />
              </button>
              <button
                className="shrink-0 rounded-md p-1 text-faint hover:bg-danger/15 hover:text-danger"
                title={t('settings.skills.delete')}
                onClick={async () => {
                  await invoke('skills:delete', s.id)
                  refresh()
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function SkillForm({
  initial,
  error,
  onCancel,
  onSave,
}: {
  initial: SkillEntry | null
  error: string | null
  onCancel: () => void
  onSave: (input: { name: string; description: string; body: string }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [saving, setSaving] = useState(false)

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-sunken p-3">
      <Field label={t('settings.skills.name')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
      </Field>
      <Field label={t('settings.skills.descriptionField')}>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
        />
      </Field>
      <Field label={t('settings.skills.body')} hint={t('settings.skills.bodyHint')}>
        <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={saving || !name.trim() || !body.trim()}
          onClick={async () => {
            setSaving(true)
            await onSave({ name, description, body })
            setSaving(false)
          }}
        >
          {t('settings.skills.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('settings.skills.cancel')}
        </Button>
      </div>
    </div>
  )
}

function newIntegration(): Integration {
  return {
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    transport: 'stdio',
    command: '',
    args: '',
    url: '',
  }
}

function IntegrationsTab() {
  const { t } = useTranslation()
  const integrations = useSettingsStore((s) => s.settings.integrations)
  const update = useSettingsStore((s) => s.update)
  const setAll = (next: Integration[]): Promise<void> => update({ integrations: next })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Integration | null>(null)

  const editing = editingId ? (integrations.find((i) => i.id === editingId) ?? draft) : null

  return (
    <Section
      title={t('settings.skills.integrationsTitle')}
      description={t('settings.skills.integrationsDescription')}
    >
      <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
        {t('settings.skills.integrationsWarning')}
      </p>
      {!editing ? (
        <Button
          size="sm"
          className="self-start"
          onClick={() => {
            const d = newIntegration()
            setDraft(d)
            setEditingId(d.id)
          }}
        >
          <Plus size={14} /> {t('settings.skills.newIntegration')}
        </Button>
      ) : (
        <IntegrationForm
          value={editing}
          onCancel={() => {
            setEditingId(null)
            setDraft(null)
          }}
          onSave={async (next) => {
            const exists = integrations.some((i) => i.id === next.id)
            await setAll(
              exists
                ? integrations.map((i) => (i.id === next.id ? next : i))
                : [...integrations, next],
            )
            setEditingId(null)
            setDraft(null)
          }}
        />
      )}
      {integrations.length === 0 && !editing ? (
        <p className="px-1 py-2 text-sm text-faint">{t('settings.skills.noIntegrations')}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {integrations.map((i) => (
            <div
              key={i.id}
              data-testid="integration-row"
              className="flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-sm"
            >
              <Switch
                checked={i.enabled}
                onCheckedChange={(v) =>
                  setAll(integrations.map((x) => (x.id === i.id ? { ...x, enabled: v } : x)))
                }
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-fg">{i.name || t('settings.skills.unnamed')}</div>
                <div className="truncate font-mono text-[11px] text-faint">
                  {i.transport === 'http' ? i.url : `${i.command} ${i.args}`.trim()}
                </div>
              </div>
              <button
                className="shrink-0 rounded-md p-1 text-faint hover:bg-line/60 hover:text-fg"
                title={t('settings.skills.edit')}
                onClick={() => {
                  setDraft(null)
                  setEditingId(i.id)
                }}
              >
                <Pencil size={14} />
              </button>
              <button
                className="shrink-0 rounded-md p-1 text-faint hover:bg-danger/15 hover:text-danger"
                title={t('settings.skills.delete')}
                onClick={() => setAll(integrations.filter((x) => x.id !== i.id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function IntegrationForm({
  value,
  onCancel,
  onSave,
}: {
  value: Integration
  onCancel: () => void
  onSave: (next: Integration) => Promise<void>
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState(value)
  const [saving, setSaving] = useState(false)
  const valid =
    form.name.trim() && (form.transport === 'http' ? form.url.trim() : form.command.trim())

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-sunken p-3">
      <Field label={t('settings.skills.name')}>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label={t('settings.skills.transport')}>
        <Select
          value={form.transport}
          onChange={(e) => setForm({ ...form, transport: e.target.value as 'stdio' | 'http' })}
        >
          <option value="stdio">stdio</option>
          <option value="http">http</option>
        </Select>
      </Field>
      {form.transport === 'stdio' ? (
        <>
          <Field label={t('settings.skills.command')}>
            <Input
              value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })}
              placeholder="npx"
            />
          </Field>
          <Field label={t('settings.skills.args')}>
            <Input
              value={form.args}
              onChange={(e) => setForm({ ...form, args: e.target.value })}
              placeholder="-y @some/mcp-server --flag value"
            />
          </Field>
        </>
      ) : (
        <Field label={t('settings.skills.url')}>
          <Input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://example.com/mcp"
          />
        </Field>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={saving || !valid}
          onClick={async () => {
            setSaving(true)
            await onSave(form)
            setSaving(false)
          }}
        >
          {t('settings.skills.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('settings.skills.cancel')}
        </Button>
      </div>
    </div>
  )
}

const ROUTINE_SCHEDULE_KINDS: RoutineScheduleKind[] = ['daily', 'interval', 'once']

function newRoutineSchedule(kind: RoutineScheduleKind): RoutineSchedule {
  switch (kind) {
    case 'daily':
      return { kind, hour: 9, minute: 0 }
    case 'interval':
      return { kind, minutes: 60 }
    case 'once':
      return { kind }
  }
}

function RoutinesTab() {
  const { t } = useTranslation()
  const [routines, setRoutines] = useState<RoutineEntry[]>([])
  const [editingId, setEditingId] = useState<string | null | 'new'>(null)
  const [error, setError] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    invoke('routines:list')
      .then(setRoutines)
      .catch(() => undefined)
  }, [])
  useEffect(() => refresh(), [refresh])

  const editing = editingId === 'new' ? null : (routines.find((r) => r.id === editingId) ?? null)
  const formOpen = editingId !== null

  return (
    <Section
      title={t('settings.skills.routinesTitle')}
      description={t('settings.skills.routinesDescription')}
    >
      {!formOpen ? (
        <Button
          size="sm"
          className="self-start"
          onClick={() => {
            setError(null)
            setEditingId('new')
          }}
        >
          <Plus size={14} /> {t('settings.skills.newRoutine')}
        </Button>
      ) : (
        <RoutineForm
          initial={editing}
          error={error}
          onCancel={() => {
            setEditingId(null)
            setError(null)
          }}
          onSave={async (input) => {
            const result = editing
              ? await invoke('routines:update', editing.id, input)
              : await invoke('routines:create', input)
            if (result.error) {
              setError(result.error)
              return
            }
            setEditingId(null)
            setError(null)
            refresh()
          }}
        />
      )}
      {routines.length === 0 && !formOpen ? (
        <p className="px-1 py-2 text-sm text-faint">{t('settings.skills.noRoutines')}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {routines.map((r) => (
            <div
              key={r.id}
              data-testid="routine-row"
              className="flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-sm"
            >
              <Switch
                checked={r.enabled}
                onCheckedChange={async (v) => {
                  await invoke('routines:setEnabled', r.id, v)
                  refresh()
                }}
              />
              <div className="min-w-0 flex-1">
                <span className="font-medium text-fg">{r.name}</span>
                <div className="text-[11px] text-faint">
                  {r.enabled && r.nextRunAt
                    ? `${t('settings.skills.nextRun')}: ${new Date(r.nextRunAt).toLocaleString()}`
                    : t('settings.skills.routineDisabled')}
                </div>
                {r.lastRun ? (
                  <div
                    className={cn('text-[11px]', r.lastRun.isError ? 'text-danger' : 'text-muted')}
                  >
                    {t('settings.skills.lastRun')}: {new Date(r.lastRun.timestamp).toLocaleString()}
                    {' — '}
                    {r.lastRun.summary.slice(0, 140)}
                  </div>
                ) : null}
              </div>
              <button
                className="shrink-0 rounded-md p-1 text-faint hover:bg-line/60 hover:text-fg disabled:opacity-30"
                title={t('settings.skills.runNow')}
                disabled={runningId === r.id}
                onClick={async () => {
                  setRunningId(r.id)
                  try {
                    await invoke('routines:runNow', r.id)
                  } catch {
                    // surfaced via lastRun (isError) on refresh; nothing further to do here
                  } finally {
                    setRunningId(null)
                    refresh()
                  }
                }}
              >
                <Play size={14} />
              </button>
              <button
                className="shrink-0 rounded-md p-1 text-faint hover:bg-line/60 hover:text-fg"
                title={t('settings.skills.edit')}
                onClick={() => {
                  setError(null)
                  setEditingId(r.id)
                }}
              >
                <Pencil size={14} />
              </button>
              <button
                className="shrink-0 rounded-md p-1 text-faint hover:bg-danger/15 hover:text-danger"
                title={t('settings.skills.delete')}
                onClick={async () => {
                  await invoke('routines:delete', r.id)
                  refresh()
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function RoutineForm({
  initial,
  error,
  onCancel,
  onSave,
}: {
  initial: RoutineEntry | null
  error: string | null
  onCancel: () => void
  onSave: (input: {
    name: string
    prompt: string
    schedule: RoutineSchedule
    safeMode: boolean
  }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [schedule, setSchedule] = useState<RoutineSchedule>(
    initial?.schedule ?? newRoutineSchedule('daily'),
  )
  const [safeMode, setSafeMode] = useState(initial?.safeMode ?? true)
  const [saving, setSaving] = useState(false)
  const valid =
    name.trim() && prompt.trim() && (schedule.kind !== 'once' || schedule.at !== undefined)

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-sunken p-3">
      <Field label={t('settings.skills.name')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
      </Field>
      <Field
        label={t('settings.skills.routinePrompt')}
        hint={t('settings.skills.routinePromptHint')}
      >
        <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <Field label={t('settings.skills.scheduleKind')}>
        <Select
          value={schedule.kind}
          onChange={(e) => setSchedule(newRoutineSchedule(e.target.value as RoutineScheduleKind))}
        >
          {ROUTINE_SCHEDULE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`settings.skills.scheduleKinds.${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      {schedule.kind === 'daily' ? (
        <div className="flex gap-2">
          <Field label={t('settings.skills.scheduleHour')} className="flex-1">
            <Input
              type="number"
              min={0}
              max={23}
              value={schedule.hour ?? 9}
              onChange={(e) => setSchedule({ ...schedule, hour: Number(e.target.value) })}
            />
          </Field>
          <Field label={t('settings.skills.scheduleMinute')} className="flex-1">
            <Input
              type="number"
              min={0}
              max={59}
              value={schedule.minute ?? 0}
              onChange={(e) => setSchedule({ ...schedule, minute: Number(e.target.value) })}
            />
          </Field>
        </div>
      ) : null}
      {schedule.kind === 'interval' ? (
        <Field label={t('settings.skills.scheduleMinutes')}>
          <Input
            type="number"
            min={1}
            value={schedule.minutes ?? 60}
            onChange={(e) => setSchedule({ ...schedule, minutes: Number(e.target.value) })}
          />
        </Field>
      ) : null}
      {schedule.kind === 'once' ? (
        <Field label={t('settings.skills.scheduleAt')}>
          <Input
            type="datetime-local"
            value={schedule.at ? toDatetimeLocal(schedule.at) : ''}
            onChange={(e) => {
              const ms = e.target.value ? new Date(e.target.value).getTime() : undefined
              setSchedule({ ...schedule, at: ms })
            }}
          />
        </Field>
      ) : null}
      <Field label={t('settings.skills.safeMode')} hint={t('settings.skills.safeModeHint')} inline>
        <Switch checked={safeMode} onCheckedChange={setSafeMode} />
      </Field>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={saving || !valid}
          onClick={async () => {
            setSaving(true)
            await onSave({ name, prompt, schedule, safeMode })
            setSaving(false)
          }}
        >
          {t('settings.skills.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('settings.skills.cancel')}
        </Button>
      </div>
    </div>
  )
}

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

const STEP_KINDS: ScenarioStepKind[] = ['open', 'wait', 'key', 'type', 'notify']

function newStep(kind: ScenarioStepKind): ScenarioStep {
  switch (kind) {
    case 'wait':
      return { kind, ms: 1000 }
    default:
      return { kind }
  }
}

function ScenariosTab() {
  const { t } = useTranslation()
  const [scenarios, setScenarios] = useState<ScenarioEntry[]>([])
  const [editingId, setEditingId] = useState<string | null | 'new'>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    invoke('scenarios:list')
      .then(setScenarios)
      .catch(() => undefined)
  }, [])
  useEffect(() => refresh(), [refresh])

  const editing = editingId === 'new' ? null : (scenarios.find((s) => s.id === editingId) ?? null)
  const formOpen = editingId !== null

  return (
    <Section
      title={t('settings.skills.scenariosTitle')}
      description={t('settings.skills.scenariosDescription')}
    >
      {!formOpen ? (
        <Button
          size="sm"
          className="self-start"
          onClick={() => {
            setError(null)
            setEditingId('new')
          }}
        >
          <Plus size={14} /> {t('settings.skills.newScenario')}
        </Button>
      ) : (
        <ScenarioForm
          initial={editing}
          error={error}
          onCancel={() => {
            setEditingId(null)
            setError(null)
          }}
          onSave={async (input) => {
            const result = editing
              ? await invoke('scenarios:update', editing.id, input)
              : await invoke('scenarios:create', input)
            if (result.error) {
              setError(result.error)
              return
            }
            setEditingId(null)
            setError(null)
            refresh()
          }}
        />
      )}
      {scenarios.length === 0 && !formOpen ? (
        <p className="px-1 py-2 text-sm text-faint">{t('settings.skills.noScenarios')}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {scenarios.map((s) => (
            <div
              key={s.id}
              data-testid="scenario-row"
              className="flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-sm"
            >
              <Switch
                checked={s.enabled}
                onCheckedChange={async (v) => {
                  await invoke('scenarios:setEnabled', s.id, v)
                  refresh()
                }}
              />
              <div className="min-w-0 flex-1">
                <span className="font-medium text-fg">{s.name}</span>
                {s.description ? (
                  <div className="text-[12px] text-muted">{s.description}</div>
                ) : null}
                <div className="text-[11px] text-faint">
                  {t('settings.skills.steps')}: {s.steps.length}
                </div>
              </div>
              <button
                className="shrink-0 rounded-md p-1 text-faint hover:bg-line/60 hover:text-fg"
                title={t('settings.skills.edit')}
                onClick={() => {
                  setError(null)
                  setEditingId(s.id)
                }}
              >
                <Pencil size={14} />
              </button>
              <button
                className="shrink-0 rounded-md p-1 text-faint hover:bg-danger/15 hover:text-danger"
                title={t('settings.skills.delete')}
                onClick={async () => {
                  await invoke('scenarios:delete', s.id)
                  refresh()
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function ScenarioForm({
  initial,
  error,
  onCancel,
  onSave,
}: {
  initial: ScenarioEntry | null
  error: string | null
  onCancel: () => void
  onSave: (input: {
    name: string
    description: string
    triggerPhrases: string[]
    steps: ScenarioStep[]
  }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [triggerPhrases, setTriggerPhrases] = useState((initial?.triggerPhrases ?? []).join(', '))
  const [steps, setSteps] = useState<ScenarioStep[]>(initial?.steps ?? [])
  const [saving, setSaving] = useState(false)
  const valid = name.trim() && steps.length > 0

  const updateStep = (i: number, patch: Partial<ScenarioStep>): void =>
    setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const moveStep = (i: number, dir: -1 | 1): void => {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    setSteps(next)
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-sunken p-3">
      <Field label={t('settings.skills.name')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
      </Field>
      <Field label={t('settings.skills.descriptionField')}>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
        />
      </Field>
      <Field
        label={t('settings.skills.triggerPhrases')}
        hint={t('settings.skills.triggerPhrasesHint')}
      >
        <Input
          value={triggerPhrases}
          onChange={(e) => setTriggerPhrases(e.target.value)}
          placeholder={t('settings.skills.triggerPhrases')}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-fg">{t('settings.skills.steps')}</span>
          <Select
            value=""
            onChange={(e) => {
              const kind = e.target.value as ScenarioStepKind
              if (kind) setSteps([...steps, newStep(kind)])
            }}
          >
            <option value="">{t('settings.skills.addStep')}</option>
            {STEP_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`settings.skills.stepKinds.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        {steps.length === 0 ? (
          <p className="text-xs text-faint">{t('settings.skills.noSteps')}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-elev p-2">
                <span className="mt-2 shrink-0 text-[11px] text-faint">{i + 1}.</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-xs font-medium text-fg">
                    {t(`settings.skills.stepKinds.${step.kind}`)}
                  </span>
                  {step.kind === 'open' ? (
                    <Input
                      value={step.target ?? ''}
                      onChange={(e) => updateStep(i, { target: e.target.value })}
                      placeholder={t('settings.skills.stepTarget')}
                    />
                  ) : null}
                  {step.kind === 'wait' ? (
                    <Input
                      type="number"
                      min={0}
                      value={step.ms ?? 1000}
                      onChange={(e) => updateStep(i, { ms: Number(e.target.value) })}
                      placeholder={t('settings.skills.stepMs')}
                    />
                  ) : null}
                  {step.kind === 'key' ? (
                    <Input
                      value={step.keys ?? ''}
                      onChange={(e) => updateStep(i, { keys: e.target.value })}
                      placeholder={t('settings.skills.stepKeys')}
                    />
                  ) : null}
                  {step.kind === 'type' ? (
                    <Input
                      value={step.text ?? ''}
                      onChange={(e) => updateStep(i, { text: e.target.value })}
                      placeholder={t('settings.skills.stepText')}
                    />
                  ) : null}
                  {step.kind === 'notify' ? (
                    <>
                      <Input
                        value={step.title ?? ''}
                        onChange={(e) => updateStep(i, { title: e.target.value })}
                        placeholder={t('settings.skills.stepTitle')}
                      />
                      <Input
                        value={step.body ?? ''}
                        onChange={(e) => updateStep(i, { body: e.target.value })}
                        placeholder={t('settings.skills.stepBody')}
                      />
                    </>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    className="rounded p-0.5 text-faint hover:bg-line/60 hover:text-fg disabled:opacity-30"
                    title={t('settings.skills.moveUp')}
                    disabled={i === 0}
                    onClick={() => moveStep(i, -1)}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    className="rounded p-0.5 text-faint hover:bg-line/60 hover:text-fg disabled:opacity-30"
                    title={t('settings.skills.moveDown')}
                    disabled={i === steps.length - 1}
                    onClick={() => moveStep(i, 1)}
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    className="rounded p-0.5 text-faint hover:bg-danger/15 hover:text-danger"
                    title={t('settings.skills.removeStep')}
                    onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={saving || !valid}
          onClick={async () => {
            setSaving(true)
            await onSave({
              name,
              description,
              triggerPhrases: triggerPhrases
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean),
              steps,
            })
            setSaving(false)
          }}
        >
          {t('settings.skills.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('settings.skills.cancel')}
        </Button>
      </div>
    </div>
  )
}
