import { useTranslation } from 'react-i18next'
import { Section } from '../../../components/ui/Field'

export function AccountSection() {
  const { t } = useTranslation()
  return <Section title={t('settings.sections.account')}><p className="text-sm text-muted">{t('common.loading')}</p></Section>
}
