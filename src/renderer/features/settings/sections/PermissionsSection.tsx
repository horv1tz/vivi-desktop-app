import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Plus, Trash2, X } from 'lucide-react'
import type { PermissionLogEntry, PermissionLogReason } from '@shared/events'
import type { PermissionRule } from '@shared/settings'
import { parseRuleContent, type RuleScope } from '@shared/permissionRules'
import { invoke, useViviEvent } from '../../../lib/bridge'
import { useSettingsStore } from '../../../stores/settings'
import { Field, Input, Section, Select } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'
import { Button } from '../../../components/ui/Button'
import { relativeTime } from '../../../lib/format'

function describeRule(
  t: (key: string, opts?: Record<string, unknown>) => string,
  r: PermissionRule,
): string {
  const scope = parseRuleContent(r.ruleContent)
  const key = `${r.behavior}${scope.kind[0]!.toUpperCase()}${scope.kind.slice(1)}`
  const value =
    scope.kind === 'prefix'
      ? scope.prefix
      : scope.kind === 'domain'
        ? scope.domain
        : scope.kind === 'path'
          ? scope.glob
          : ''
  return t(`settings.permissionsUi.ruleDescription.${key}`, { tool: r.toolName, value })
}

export function PermissionsSection() {
  const { t } = useTranslation()
  const s = useSettingsStore((x) => x.settings.permissions)
  const update = useSettingsStore((x) => x.update)
  const set = (patch: Partial<typeof s>): void => void update({ permissions: patch })

  return (
    <>
      <Section
        title={t('settings.permissionsUi.categories')}
        description={t('settings.permissionsUi.categoriesHint')}
      >
        <Field
          label={t('settings.permissionsUi.autoAllowReadOnly')}
          hint={t('settings.permissionsUi.readOnlyHint')}
          inline
        >
          <Switch
            checked={s.autoAllowReadOnly}
            onCheckedChange={(v) => set({ autoAllowReadOnly: v })}
          />
        </Field>
        <Field
          label={t('settings.permissionsUi.autoAllowScreenshot')}
          hint={t('settings.permissionsUi.autoAllowScreenshotHint')}
          inline
        >
          <Switch
            checked={s.autoAllowScreenshot}
            onCheckedChange={(v) => set({ autoAllowScreenshot: v })}
          />
        </Field>
        <Field
          label={t('settings.permissionsUi.autoAllowClipboardRead')}
          hint={t('settings.permissionsUi.autoAllowClipboardReadHint')}
          inline
        >
          <Switch
            checked={s.autoAllowClipboardRead}
            onCheckedChange={(v) => set({ autoAllowClipboardRead: v })}
          />
        </Field>
        <Field label={t('settings.permissionsUi.askForEdits')} inline>
          <Switch checked={s.askForEdits} onCheckedChange={(v) => set({ askForEdits: v })} />
        </Field>
        <Field label={t('settings.permissionsUi.askForExec')} inline>
          <Switch checked={s.askForExec} onCheckedChange={(v) => set({ askForExec: v })} />
        </Field>
        <Field label={t('settings.permissionsUi.askForInput')} inline>
          <Switch checked={s.askForInput} onCheckedChange={(v) => set({ askForInput: v })} />
        </Field>
        <Field label={t('settings.permissionsUi.askForSystem')} inline>
          <Switch checked={s.askForSystem} onCheckedChange={(v) => set({ askForSystem: v })} />
        </Field>
        <p className="text-xs text-faint">{t('settings.permissionsUi.dangerNote')}</p>
      </Section>

      <Section
        title={t('settings.permissionsUi.trustedFolders')}
        description={t('settings.permissionsUi.trustedFoldersHint')}
      >
        {s.trustedFolders.length === 0 ? (
          <p className="text-sm text-faint">{t('settings.permissionsUi.noTrustedFolders')}</p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          {s.trustedFolders.map((f) => (
            <div
              key={f}
              className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{f}</span>
              <button
                className="text-faint hover:text-danger"
                title={t('common.remove')}
                onClick={() => set({ trustedFolders: s.trustedFolders.filter((x) => x !== f) })}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <Button
          size="sm"
          className="self-start"
          onClick={async () => {
            const dir = await invoke('settings:pickDirectory', undefined)
            if (dir && !s.trustedFolders.includes(dir))
              set({ trustedFolders: [...s.trustedFolders, dir] })
          }}
        >
          <FolderOpen size={16} /> {t('settings.permissionsUi.addTrustedFolder')}
        </Button>
      </Section>

      <RulesSection
        rules={s.alwaysAllowRules}
        setRules={(next) => set({ alwaysAllowRules: next })}
      />

      <DecisionLogSection />
    </>
  )
}

function RulesSection({
  rules,
  setRules,
}: {
  rules: PermissionRule[]
  setRules: (next: PermissionRule[]) => void
}) {
  const { t } = useTranslation()
  const [formOpen, setFormOpen] = useState(false)

  return (
    <Section
      title={t('settings.permissionsUi.rules')}
      description={t('settings.permissionsUi.rulesHint')}
    >
      {rules.length === 0 && !formOpen ? (
        <p className="text-sm text-faint">{t('settings.permissionsUi.noRules')}</p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        {rules.map((r, i) => (
          <div
            key={`${r.toolName}-${r.ruleContent ?? ''}-${i}`}
            className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-sm"
          >
            <span
              className={
                r.behavior === 'deny'
                  ? 'shrink-0 rounded bg-danger/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-danger'
                  : 'shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent'
              }
            >
              {t(`settings.permissionsUi.ruleBehaviors.${r.behavior}`)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate">{describeRule(t, r)}</div>
              <div className="truncate font-mono text-[11px] text-faint">
                {r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName}
              </div>
            </div>
            <button
              className="shrink-0 text-faint hover:text-danger"
              title={t('common.remove')}
              onClick={() => setRules(rules.filter((_, j) => j !== i))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      {formOpen ? (
        <AddRuleForm
          onCancel={() => setFormOpen(false)}
          onSave={(rule) => {
            setRules([...rules, rule])
            setFormOpen(false)
          }}
        />
      ) : (
        <Button size="sm" className="self-start" onClick={() => setFormOpen(true)}>
          <Plus size={14} /> {t('settings.permissionsUi.addRule')}
        </Button>
      )}
    </Section>
  )
}

function AddRuleForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void
  onSave: (rule: PermissionRule) => void
}) {
  const { t } = useTranslation()
  const [toolName, setToolName] = useState('Bash')
  const [scopeKind, setScopeKind] = useState<RuleScope['kind']>('bare')
  const [value, setValue] = useState('')
  const [behavior, setBehavior] = useState<'allow' | 'deny'>('allow')

  const ruleContent =
    scopeKind === 'bare'
      ? undefined
      : scopeKind === 'prefix'
        ? `${value}:*`
        : scopeKind === 'domain'
          ? `domain:${value}`
          : `path:${value}`
  const valid = toolName.trim() && (scopeKind === 'bare' || value.trim())
  const preview = valid ? describeRule(t, { toolName: toolName.trim(), ruleContent, behavior }) : ''

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-sunken p-3">
      <Field
        label={t('settings.permissionsUi.ruleTool')}
        hint={t('settings.permissionsUi.ruleToolHint')}
      >
        <Input value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="Bash" />
      </Field>
      <Field label={t('settings.permissionsUi.ruleBehavior')}>
        <Select value={behavior} onChange={(e) => setBehavior(e.target.value as 'allow' | 'deny')}>
          <option value="allow">{t('settings.permissionsUi.ruleBehaviors.allow')}</option>
          <option value="deny">{t('settings.permissionsUi.ruleBehaviors.deny')}</option>
        </Select>
      </Field>
      <Field label={t('settings.permissionsUi.ruleScope')}>
        <Select
          value={scopeKind}
          onChange={(e) => setScopeKind(e.target.value as RuleScope['kind'])}
        >
          <option value="bare">{t('settings.permissionsUi.ruleScopeKinds.bare')}</option>
          <option value="prefix">{t('settings.permissionsUi.ruleScopeKinds.prefix')}</option>
          <option value="domain">{t('settings.permissionsUi.ruleScopeKinds.domain')}</option>
          <option value="path">{t('settings.permissionsUi.ruleScopeKinds.path')}</option>
        </Select>
      </Field>
      {scopeKind !== 'bare' ? (
        <Field
          label={t('settings.permissionsUi.ruleValue')}
          hint={t(`settings.permissionsUi.ruleValueHint.${scopeKind}`)}
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              scopeKind === 'prefix' ? 'git' : scopeKind === 'domain' ? 'example.com' : '~/Vivi/**'
            }
          />
        </Field>
      ) : null}
      {preview ? (
        <p className="rounded-lg bg-elev px-3 py-2 text-xs text-muted">
          {t('settings.permissionsUi.rulePreview')} {preview}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!valid}
          onClick={() => onSave({ toolName: toolName.trim(), ruleContent, behavior })}
        >
          {t('settings.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('settings.cancel')}
        </Button>
      </div>
    </div>
  )
}

const REASON_KEY: Record<PermissionLogReason, string> = {
  'deny-rule': 'denyRule',
  'trusted-folder': 'trustedFolder',
  'auto-category': 'autoCategory',
  'allow-rule': 'allowRule',
  'session-grant': 'sessionGrant',
  'turn-grant': 'turnGrant',
  'dialog-allow': 'dialogAllow',
  'dialog-allow-session': 'dialogAllowSession',
  'dialog-allow-always': 'dialogAllowAlways',
  'dialog-deny': 'dialogDeny',
}

function DecisionLogSection() {
  const { t } = useTranslation()
  const lang = useSettingsStore((s) => s.settings.appearance.language)
  const [entries, setEntries] = useState<PermissionLogEntry[]>([])

  const refresh = useCallback(() => {
    invoke('permissions:log')
      .then(setEntries)
      .catch(() => undefined)
  }, [])
  useEffect(() => refresh(), [refresh])
  useViviEvent(
    'agent:event',
    useCallback((e) => (e.type === 'tool-use' ? refresh() : undefined), [refresh]),
  )
  useViviEvent('permission:resolved', refresh)

  return (
    <Section
      title={t('settings.permissionsUi.decisionLog')}
      description={t('settings.permissionsUi.decisionLogHint')}
    >
      {entries.length === 0 ? (
        <p className="text-sm text-faint">{t('settings.permissionsUi.noDecisions')}</p>
      ) : (
        <>
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {entries.slice(0, 50).map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-sm"
              >
                <span
                  className={
                    e.verdict === 'deny'
                      ? 'shrink-0 rounded bg-danger/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-danger'
                      : 'shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent'
                  }
                >
                  {t(`settings.permissionsUi.verdict.${e.verdict}`)}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-[12px]">{e.toolName}</span>
                  <span className="ml-1.5 text-[11px] text-faint">
                    {t(`settings.permissionsUi.reasons.${REASON_KEY[e.reason]}`)}
                  </span>
                </div>
                <span className="shrink-0 text-[11px] text-faint">
                  {relativeTime(e.timestamp, lang)}
                </span>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={async () => {
              await invoke('permissions:clearLog')
              refresh()
            }}
          >
            <Trash2 size={14} /> {t('settings.permissionsUi.clearLog')}
          </Button>
        </>
      )}
    </Section>
  )
}
