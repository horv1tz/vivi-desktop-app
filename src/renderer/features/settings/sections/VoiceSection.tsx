import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Volume2 } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settings'
import { useVoiceStore } from '../../../stores/voice'
import { invoke } from '../../../lib/bridge'
import { Field, Input, Section, Select } from '../../../components/ui/Field'
import { Switch } from '../../../components/ui/Switch'
import { Button } from '../../../components/ui/Button'
import { VoiceModelsPanel } from '../../voice/VoiceModelsPanel'
import { Orb } from '../../../components/motion/Orb'

export function VoiceSection() {
  const { t } = useTranslation()
  const s = useSettingsStore((x) => x.settings.voice)
  const features = useSettingsStore((x) => x.settings.features)
  const update = useSettingsStore((x) => x.update)
  const set = (patch: Partial<typeof s>): void => void update({ voice: patch })
  const voice = useVoiceStore()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [openaiKey, setOpenaiKey] = useState('')
  const [testText, setTestText] = useState('')

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then(setDevices)
      .catch(() => setDevices([]))
  }, [])

  const inputs = devices.filter((d) => d.kind === 'audioinput')
  const outputs = devices.filter((d) => d.kind === 'audiooutput')

  return (
    <>
      <Section title={t('voice.status')}>
        <div className="flex items-center gap-4">
          <Orb state={voice.state === 'off' ? 'idle' : voice.state} level={voice.level} size={64} />
          <div className="flex-1 text-sm">
            <div className="font-medium">{t(`voice.states.${voice.state}`)}</div>
            {voice.detail ? <div className="text-xs text-muted">{voice.detail}</div> : null}
            {voice.transcript ? (
              <div className="text-xs text-faint">«{voice.transcript}»</div>
            ) : null}
          </div>
          <Button onClick={() => invoke('voice:pushToTalk', voice.state !== 'listening')}>
            <Mic size={16} />{' '}
            {voice.state === 'listening' ? t('composer.stop') : t('voice.testMic')}
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder={t('voice.testTtsPlaceholder')}
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
          />
          <Button onClick={() => invoke('voice:speak', testText || t('voice.testTtsDefault'))}>
            <Volume2 size={16} /> {t('voice.testTts')}
          </Button>
        </div>
      </Section>
      <Section title={t('settings.sections.voice')}>
        <Field label={t('voice.enabled')} inline>
          <Switch checked={s.enabled} onCheckedChange={(v) => set({ enabled: v })} />
        </Field>
        <Field label={t('voice.language')} inline>
          <Select
            value={s.language}
            onChange={(e) => set({ language: e.target.value as typeof s.language })}
          >
            <option value="ru">Русский</option>
            <option value="en">English</option>
            <option value="auto">{t('voice.auto')}</option>
          </Select>
        </Field>
        <Field label={t('voice.speakReplies')} inline>
          <Switch checked={s.speakReplies} onCheckedChange={(v) => set({ speakReplies: v })} />
        </Field>
        <Field label={t('voice.silence')} hint={t('voice.silenceHint')} inline>
          <Input
            type="number"
            className="w-28"
            min={300}
            max={3000}
            step={100}
            value={s.silenceMs}
            onChange={(e) =>
              set({ silenceMs: Math.min(3000, Math.max(300, Number(e.target.value) || 800)) })
            }
          />
        </Field>
        <Field label={t('voice.followup')} hint={t('voice.followupHint')} inline>
          <Input
            type="number"
            className="w-28"
            min={0}
            max={30_000}
            step={500}
            value={s.followupMs}
            onChange={(e) =>
              set({ followupMs: Math.min(30_000, Math.max(0, Number(e.target.value) || 0)) })
            }
          />
        </Field>
        <Field label={t('voice.inputDevice')} inline>
          <Select value={s.inputDeviceId} onChange={(e) => set({ inputDeviceId: e.target.value })}>
            <option value="">{t('voice.defaultDevice')}</option>
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('voice.outputDevice')} inline>
          <Select
            value={s.outputDeviceId}
            onChange={(e) => set({ outputDeviceId: e.target.value })}
          >
            <option value="">{t('voice.defaultDevice')}</option>
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId}
              </option>
            ))}
          </Select>
        </Field>
      </Section>
      <Section title={t('voice.wakeWord')} description={t('voice.wakeWordHint')}>
        <Field label={t('voice.wakeWordEnabled')} inline>
          <Switch
            checked={s.wakeWordEnabled}
            onCheckedChange={(v) => set({ wakeWordEnabled: v })}
          />
        </Field>
        <Field label={t('voice.wakeWordStrategy')} inline>
          <Select
            value={s.wakeWordStrategy}
            onChange={(e) => set({ wakeWordStrategy: e.target.value as typeof s.wakeWordStrategy })}
          >
            <option value="kws">{t('voice.strategies.kws')}</option>
            <option value="transcript">{t('voice.strategies.transcript')}</option>
          </Select>
        </Field>
        <Field label={t('voice.sensitivity')} inline>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.wakeWordSensitivity}
            onChange={(e) => set({ wakeWordSensitivity: Number(e.target.value) })}
            className="w-40 accent-[var(--accent)]"
          />
        </Field>
      </Section>
      <Section title={t('voice.models')} description={t('voice.modelsHint')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('voice.sttModel')}>
            <Select value={s.sttModel} onChange={(e) => set({ sttModel: e.target.value })}>
              {[
                'stt-zipformer-small-ru',
                'stt-zipformer-ru',
                'stt-gigaam-v2-ru',
                'stt-zipformer-en',
                'stt-whisper-base',
                'stt-whisper-turbo',
              ].map((id) => (
                <option key={id} value={id}>
                  {id.replace('stt-', '')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('voice.ttsVoice')}>
            <Select value={s.ttsVoice} onChange={(e) => set({ ttsVoice: e.target.value })}>
              {[
                'tts-piper-ru-irina',
                'tts-piper-ru-denis',
                'tts-piper-ru-dmitri',
                'tts-piper-ru-ruslan',
                'tts-piper-en-lessac',
                'tts-piper-en-amy',
              ].map((id) => (
                <option key={id} value={id}>
                  {id.replace('tts-piper-', '')}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <VoiceModelsPanel />
      </Section>
      <Section title={t('voice.cloud')} description={t('voice.cloudHint')}>
        <Field label={t('voice.cloudEnabled')} inline>
          <Switch
            checked={features.cloudVoice}
            onCheckedChange={(v) => update({ features: { cloudVoice: v } })}
          />
        </Field>
        {features.cloudVoice ? (
          <>
            <Field label={t('voice.sttProvider')} inline>
              <Select
                value={s.sttProvider}
                onChange={(e) => set({ sttProvider: e.target.value as typeof s.sttProvider })}
              >
                <option value="local">{t('voice.local')}</option>
                <option value="openai">OpenAI</option>
              </Select>
            </Field>
            <Field label={t('voice.ttsProvider')} inline>
              <Select
                value={s.ttsProvider}
                onChange={(e) => set({ ttsProvider: e.target.value as typeof s.ttsProvider })}
              >
                <option value="local">{t('voice.local')}</option>
                <option value="openai">OpenAI</option>
              </Select>
            </Field>
            <Field label="OpenAI API key">
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="sk-…"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                />
                <Button
                  disabled={!openaiKey}
                  onClick={async () => {
                    await invoke('voice:setCloudKey', 'openai', openaiKey)
                    setOpenaiKey('')
                  }}
                >
                  {t('settings.save')}
                </Button>
              </div>
            </Field>
          </>
        ) : null}
      </Section>
    </>
  )
}
