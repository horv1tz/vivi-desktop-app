import { useTranslation } from 'react-i18next'

/** Filled in by the voice phase: model download list with progress. */
export function VoiceModelsPanel() {
  const { t } = useTranslation()
  return <p className="text-sm text-muted">{t('common.loading')}</p>
}
