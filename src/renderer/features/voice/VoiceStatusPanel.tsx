import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, Volume2 } from 'lucide-react'
import { useVoiceStore } from '../../stores/voice'
import { invoke } from '../../lib/bridge'
import { Input } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { Orb } from '../../components/motion/Orb'

/**
 * The live mic/TTS test widget (orb + state, push-to-talk, speak-test), shared by the Voice
 * settings section and the onboarding voice step ("say Vivi" / test the mic) so the same real
 * pipeline is exercised in both places instead of two separate implementations drifting apart.
 */
export function VoiceStatusPanel() {
  const { t } = useTranslation()
  const voice = useVoiceStore()
  const [testText, setTestText] = useState('')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <Orb state={voice.state === 'off' ? 'idle' : voice.state} level={voice.level} size={64} />
        <div className="flex-1 text-sm">
          <div className="font-medium">{t(`voice.states.${voice.state}`)}</div>
          {voice.detail ? <div className="text-xs text-muted">{voice.detail}</div> : null}
          {voice.transcript ? <div className="text-xs text-faint">«{voice.transcript}»</div> : null}
        </div>
        <Button onClick={() => invoke('voice:pushToTalk', voice.state !== 'listening')}>
          <Mic size={16} /> {voice.state === 'listening' ? t('composer.stop') : t('voice.testMic')}
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
    </div>
  )
}
