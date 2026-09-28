import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, KeyRound, Plus, X } from 'lucide-react'
import type { AcpAuthMethod } from '@shared/events'
import { ACP_PRESETS } from '@shared/acp-presets'
import { useSettingsStore } from '../../../stores/settings'
import { invoke } from '../../../lib/bridge'
import { Field, Input, Section, Select, Textarea } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'
import { Button } from '../../../components/ui/Button'
import { cn } from '../../../lib/cn'

export function AgentSection() {
  const { t } = useTranslation()
  const s = useSettingsStore((x) => x.settings.agent)
  const update = useSettingsStore((x) => x.update)
  const set = (patch: Partial<typeof s>): void => void update({ agent: patch })
  const [models, setModels] = useState<{ id: string; name: string; description?: string }[]>([])

  useEffect(() => {
    invoke('agent:listModels')
      .then(setModels)
      .catch(() => setModels([]))
  }, [])

  return (
    <>
      <Section title={t('settings.agent.backend')} description={t('settings.agent.backendHint')}>
        <Field label={t('settings.agent.backend')} inline>
          <Select
            value={s.backend}
            onChange={(e) => set({ backend: e.target.value as typeof s.backend })}
          >
            <option value="sdk">{t('settings.agent.backends.sdk')}</option>
            <option value="acp">{t('settings.agent.backends.acp')}</option>
          </Select>
        </Field>
        {s.backend === 'acp' ? (
          <>
            <Field
              label={t('settings.agent.acpPreset')}
              hint={t('settings.agent.acpPresetHint')}
              inline
            >
              <Select
                value=""
                onChange={(e) => {
                  const preset = ACP_PRESETS.find((p) => p.id === e.target.value)
                  if (preset) set({ acpCommand: preset.command, acpArgs: preset.args })
                }}
              >
                <option value="">{t('settings.agent.acpPresetPlaceholder')}</option>
                {ACP_PRESETS.map((p) => (
                  <option key={p.id} value={p.id} title={p.description}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('settings.agent.acpCommand')} hint={t('settings.agent.acpCommandHint')}>
              <Input
                key={s.acpCommand}
                defaultValue={s.acpCommand}
                placeholder={t('settings.agent.acpCommandPlaceholder')}
                onBlur={(e) =>
                  e.target.value.trim() !== s.acpCommand &&
                  set({ acpCommand: e.target.value.trim() })
                }
              />
            </Field>
            <Field label={t('settings.agent.acpArgs')} hint={t('settings.agent.acpArgsHint')}>
              <Input
                key={s.acpArgs}
                defaultValue={s.acpArgs}
                placeholder="--model claude-sonnet-5"
                onBlur={(e) => e.target.value !== s.acpArgs && set({ acpArgs: e.target.value })}
              />
            </Field>
            <p className="text-xs text-muted">{t('settings.agent.acpNote')}</p>
            <AcpAuthPanel acpCommand={s.acpCommand} acpArgs={s.acpArgs} />
          </>
        ) : null}
      </Section>
      <Section title={t('settings.agent.model')}>
        <Field label={t('settings.agent.model')} inline>
          <Select value={s.model} onChange={(e) => set({ model: e.target.value })}>
            <option value="">{t('settings.agent.modelDefault')}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            {s.model && !models.some((m) => m.id === s.model) ? (
              <option value={s.model}>{s.model}</option>
            ) : null}
          </Select>
        </Field>
        <Field label={t('settings.agent.fallbackModel')} inline>
          <Select value={s.fallbackModel} onChange={(e) => set({ fallbackModel: e.target.value })}>
            <option value="">—</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('settings.agent.effort')} inline>
          <Select
            value={s.effort}
            onChange={(e) => set({ effort: e.target.value as typeof s.effort })}
          >
            <option value="default">{t('settings.agent.effortDefault')}</option>
            {['low', 'medium', 'high', 'xhigh', 'max'].map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('settings.agent.permissionMode')} inline>
          <Select
            value={s.permissionMode}
            onChange={(e) => set({ permissionMode: e.target.value as typeof s.permissionMode })}
          >
            {(['default', 'acceptEdits', 'auto', 'bypassPermissions'] as const).map((m) => (
              <option key={m} value={m}>
                {t(`settings.agent.permissionModes.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        {s.permissionMode === 'bypassPermissions' ? (
          <p className="rounded-xl bg-danger/10 p-3 text-xs text-danger">
            {t('settings.agent.bypassWarning')}
          </p>
        ) : null}
      </Section>
      <Section
        title={t('settings.agent.workspace')}
        description={t('settings.agent.workspaceHint')}
      >
        <div className="flex gap-2">
          <Input
            key={s.workspaceDir}
            defaultValue={s.workspaceDir}
            placeholder="~/Vivi"
            onBlur={(e) =>
              e.target.value !== s.workspaceDir && set({ workspaceDir: e.target.value })
            }
          />
          <Button
            onClick={async () => {
              const dir = await invoke('settings:pickDirectory', s.workspaceDir || undefined)
              if (dir) set({ workspaceDir: dir })
            }}
          >
            <FolderOpen size={16} /> {t('settings.agent.choose')}
          </Button>
        </div>
        <Field label={t('settings.agent.additionalDirs')}>
          <div className="flex flex-col gap-1.5">
            {s.additionalDirectories.map((d) => (
              <div
                key={d}
                className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{d}</span>
                <button
                  className="text-faint hover:text-danger"
                  onClick={() =>
                    set({ additionalDirectories: s.additionalDirectories.filter((x) => x !== d) })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <Button
              size="sm"
              className="self-start"
              onClick={async () => {
                const dir = await invoke('settings:pickDirectory', undefined)
                if (dir && !s.additionalDirectories.includes(dir))
                  set({ additionalDirectories: [...s.additionalDirectories, dir] })
              }}
            >
              <Plus size={14} /> {t('settings.agent.addDir')}
            </Button>
          </div>
        </Field>
      </Section>
      <Section title={t('settings.sections.agent')}>
        <Field label={t('settings.agent.maxTurns')} inline>
          <Input
            type="number"
            className="w-28"
            min={1}
            max={500}
            key={s.maxTurns}
            defaultValue={s.maxTurns}
            onBlur={(e) => {
              const v = Math.max(1, Number(e.target.value) || 1)
              if (v !== s.maxTurns) set({ maxTurns: v })
            }}
          />
        </Field>
        <Field label={t('settings.agent.maxBudget')} inline>
          <Input
            type="number"
            className="w-28"
            min={0}
            step={0.5}
            key={s.maxBudgetUsd}
            defaultValue={s.maxBudgetUsd}
            onBlur={(e) => {
              const v = Math.max(0, Number(e.target.value) || 0)
              if (v !== s.maxBudgetUsd) set({ maxBudgetUsd: v })
            }}
          />
        </Field>
        <Field label={t('settings.agent.continueLast')} inline>
          <Switch
            checked={s.continueLastSession}
            onCheckedChange={(v) => set({ continueLastSession: v })}
          />
        </Field>
        <Field
          label={t('settings.agent.customInstructions')}
          hint={t('settings.agent.customInstructionsHint')}
        >
          <Textarea
            key={s.customInstructions}
            rows={4}
            defaultValue={s.customInstructions}
            onBlur={(e) =>
              e.target.value !== s.customInstructions && set({ customInstructions: e.target.value })
            }
          />
        </Field>
      </Section>
      <Section
        title={t('settings.agent.screenshotFormat')}
        description={t('settings.agent.screenshotFormatHint')}
      >
        <Field label={t('settings.agent.screenshotFormat')} inline>
          <Select
            value={s.screenshotFormat}
            onChange={(e) => set({ screenshotFormat: e.target.value as typeof s.screenshotFormat })}
          >
            <option value="png">{t('settings.agent.screenshotFormats.png')}</option>
            <option value="jpeg">{t('settings.agent.screenshotFormats.jpeg')}</option>
          </Select>
        </Field>
        {s.screenshotFormat === 'jpeg' ? (
          <Field label={t('settings.agent.screenshotQuality')} inline>
            <Input
              type="number"
              className="w-28"
              min={10}
              max={100}
              key={s.screenshotQuality}
              defaultValue={s.screenshotQuality}
              onBlur={(e) => {
                const v = Math.min(100, Math.max(10, Number(e.target.value) || 80))
                if (v !== s.screenshotQuality) set({ screenshotQuality: v })
              }}
            />
          </Field>
        ) : null}
      </Section>
    </>
  )
}

/**
 * ACP-02: `authenticate()` support. Only matters for a custom third-party ACP agent — the bundled
 * Claude adapter never reports any auth methods, since Vivi's own AuthManager (Settings → Account)
 * already authenticates it via env vars before the process even starts. Re-checks whenever the
 * command/args actually change (both fields commit on blur, so this isn't refetching per keystroke).
 */
function AcpAuthPanel({ acpCommand, acpArgs }: { acpCommand: string; acpArgs: string }) {
  const { t } = useTranslation()
  const [methods, setMethods] = useState<AcpAuthMethod[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [result, setResult] = useState<{ methodId: string; error?: string } | null>(null)

  useEffect(() => {
    let alive = true
    invoke('agent:acpAuthMethods')
      .then((m) => {
        if (!alive) return
        setMethods(m)
        setResult(null)
      })
      .catch(() => alive && setMethods([]))
    return () => {
      alive = false
    }
  }, [acpCommand, acpArgs])

  if (methods.length === 0) return null

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-sunken/60 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-fg">
        <KeyRound size={13} className="text-accent" /> {t('settings.agent.acpAuthTitle')}
      </div>
      {methods.map((m) => (
        <div key={m.id} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-fg">{m.name}</div>
            {m.description ? <div className="text-xs text-muted">{m.description}</div> : null}
          </div>
          <Button
            size="sm"
            disabled={pending !== null}
            onClick={async () => {
              setPending(m.id)
              setResult(null)
              try {
                await invoke('agent:acpAuthenticate', m.id)
                setResult({ methodId: m.id })
              } catch (err) {
                setResult({
                  methodId: m.id,
                  error: err instanceof Error ? err.message : String(err),
                })
              } finally {
                setPending(null)
              }
            }}
          >
            {pending === m.id ? t('common.loading') : t('settings.agent.acpAuthSignIn')}
          </Button>
        </div>
      ))}
      {result ? (
        <p className={cn('text-xs', result.error ? 'text-danger' : 'text-success')}>
          {result.error
            ? `${t('settings.agent.acpAuthError')}: ${result.error}`
            : t('settings.agent.acpAuthSuccess')}
        </p>
      ) : null}
    </div>
  )
}
