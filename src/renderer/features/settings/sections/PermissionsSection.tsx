import { useTranslation } from 'react-i18next'
import { Section } from '../../../components/ui/Field'

export function PermissionsSection() {
  const { t } = useTranslation()
  return <Section title={t('settings.sections.permissions')}><p className="text-sm text-muted">{t('common.loading')}</p></Section>
}
