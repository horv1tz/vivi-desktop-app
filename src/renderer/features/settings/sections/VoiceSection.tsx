import { useTranslation } from 'react-i18next'
import { Section } from '../../../components/ui/Field'

export function VoiceSection() {
  const { t } = useTranslation()
  return <Section title={t('settings.sections.voice')}><p className="text-sm text-muted">{t('common.loading')}</p></Section>
}
