import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Plus, X } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settings'
import { invoke } from '../../../lib/bridge'
import { Field, Input, Section, Select, Textarea } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'
import { Button } from '../../../components/ui/Button'

export function AgentSection() {
  const { t } = useTranslation()
  const s = useSettingsStore((x) => x.settings.agent)
  const update = useSettingsStore((x) => x.update)
  const set = (patch: Partial<typeof s>): void => void update({ agent: patch })
  const [models, setModels] = useState<{ id: string; name: string; description?: string }[]>([])

  useEffect(() => {
    invoke('agent:listModels').then(setModels).catch(() => setModels([]))
  }, [])

  return (
    <>
      <Section title={t('settings.agent.model')}>
        <Field label={t('settings.agent.model')} inline>
          <Select value={s.model} onChange={(e) => set({ model: e.target.value })}>
            <option value="">{t('settings.agent.modelDefault')}</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            {s.model && !models.some((m) => m.id === s.model) ? <option value={s.model}>{s.model}</option> : null}
          </Select>
        </Field>
        <Field label={t('settings.agent.fallbackModel')} inline>
          <Select value={s.fallbackModel} onChange={(e) => set({ fallbackModel: e.target.value })}>
            <option value="">—</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label={t('settings.agent.effort')} inline>
          <Select value={s.effort} onChange={(e) => set({ effort: e.target.value as typeof s.effort })}>
            <option value="default">{t('settings.agent.effortDefault')}</option>
            {['low', 'medium', 'high', 'xhigh', 'max'].map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        </Field>
        <Field label={t('settings.agent.permissionMode')} inline>
          <Select value={s.permissionMode} onChange={(e) => set({ permissionMode: e.target.value as typeof s.permissionMode })}>
            {(['default', 'acceptEdits', 'auto', 'bypassPermissions'] as const).map((m) => <option key={m} value={m}>{t(`settings.agent.permissionModes.${m}`)}</option>)}
          </Select>
        </Field>
        {s.permissionMode === 'bypassPermissions' ? <p className="rounded-xl bg-danger/10 p-3 text-xs text-danger">{t('settings.agent.bypassWarning')}</p> : null}
      </Section>
      <Section title={t('settings.agent.workspace')} description={t('settings.agent.workspaceHint')}>
        <div className="flex gap-2">
          <Input value={s.workspaceDir} placeholder="~/Vivi" onChange={(e) => set({ workspaceDir: e.target.value })} />
          <Button onClick={async () => { const dir = await invoke('settings:pickDirectory', s.workspaceDir || undefined); if (dir) set({ workspaceDir: dir }) }}><FolderOpen size={16} /> {t('settings.agent.choose')}</Button>
        </div>
        <Field label={t('settings.agent.additionalDirs')}>
          <div className="flex flex-col gap-1.5">
            {s.additionalDirectories.map((d) => (
              <div key={d} className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{d}</span>
                <button className="text-faint hover:text-danger" onClick={() => set({ additionalDirectories: s.additionalDirectories.filter((x) => x !== d) })}><X size={14} /></button>
              </div>
            ))}
            <Button size="sm" className="self-start" onClick={async () => { const dir = await invoke('settings:pickDirectory', undefined); if (dir && !s.additionalDirectories.includes(dir)) set({ additionalDirectories: [...s.additionalDirectories, dir] }) }}>
              <Plus size={14} /> {t('settings.agent.addDir')}
            </Button>
          </div>
        </Field>
      </Section>
      <Section title={t('settings.sections.agent')}>
        <Field label={t('settings.agent.maxTurns')} inline>
          <Input type="number" className="w-28" min={1} max={500} value={s.maxTurns} onChange={(e) => set({ maxTurns: Math.max(1, Number(e.target.value) || 1) })} />
        </Field>
        <Field label={t('settings.agent.maxBudget')} inline>
          <Input type="number" className="w-28" min={0} step={0.5} value={s.maxBudgetUsd} onChange={(e) => set({ maxBudgetUsd: Math.max(0, Number(e.target.value) || 0) })} />
        </Field>
        <Field label={t('settings.agent.continueLast')} inline>
          <Switch checked={s.continueLastSession} onCheckedChange={(v) => set({ continueLastSession: v })} />
        </Field>
        <Field label={t('settings.agent.customInstructions')} hint={t('settings.agent.customInstructionsHint')}>
          <Textarea key={s.customInstructions} rows={4} defaultValue={s.customInstructions} onBlur={(e) => e.target.value !== s.customInstructions && set({ customInstructions: e.target.value })} />
        </Field>
      </Section>
    </>
  )
}
