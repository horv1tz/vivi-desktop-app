import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { SkillEntry } from '@shared/events'
import type { Integration } from '@shared/settings'
import { invoke } from '../../../lib/bridge'
import { Field, Input, Section, Select, Textarea } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'
import { Button } from '../../../components/ui/Button'
import { cn } from '../../../lib/cn'
import { useSettingsStore } from '../../../stores/settings'

type Tab = 'skills' | 'integrations'

export function SkillsSection() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('skills')
  return (
    <>
      <div className="flex gap-1 rounded-xl bg-sunken p-1">
        {(['skills', 'integrations'] as const).map((tb) => (
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
      {tab === 'skills' ? <SkillsTab /> : <IntegrationsTab />}
    </>
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
