import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { ArrowLeft } from 'lucide-react'
import { useUiStore, type SettingsSection } from '../../stores/ui'
import { cn } from '../../lib/cn'
import { GeneralSection } from './sections/GeneralSection'
import { AgentSection } from './sections/AgentSection'
import { AboutSection } from './sections/AboutSection'
import { AccountSection } from './sections/AccountSection'
import { ProxySection } from './sections/ProxySection'
import { VoiceSection } from './sections/VoiceSection'
import { PermissionsSection } from './sections/PermissionsSection'
import { Button } from '../../components/ui/Button'

const sections: SettingsSection[] = [
  'general',
  'account',
  'agent',
  'voice',
  'proxy',
  'permissions',
  'about',
]

export function SettingsView() {
  const { t } = useTranslation()
  const section = useUiStore((s) => s.settingsSection)
  const openSettings = useUiStore((s) => s.openSettings)
  const setView = useUiStore((s) => s.setView)

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-line p-3">
        <Button variant="ghost" className="mb-2 justify-start" onClick={() => setView('chat')}>
          <ArrowLeft size={16} /> {t('nav.chat')}
        </Button>
        {sections.map((s) => (
          <button
            key={s}
            onClick={() => openSettings(s)}
            className={cn(
              'rounded-lg px-3 py-2 text-left text-sm transition-colors',
              section === s ? 'bg-line/70 text-fg' : 'text-muted hover:bg-line/40 hover:text-fg',
            )}
          >
            {t(`settings.sections.${s}`)}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <motion.div
          key={section}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18 }}
          className="mx-auto flex max-w-2xl flex-col gap-4 p-6"
        >
          <h2 className="text-xl font-semibold">{t(`settings.sections.${section}`)}</h2>
          {section === 'general' ? <GeneralSection /> : null}
          {section === 'account' ? <AccountSection /> : null}
          {section === 'agent' ? <AgentSection /> : null}
          {section === 'voice' ? <VoiceSection /> : null}
          {section === 'proxy' ? <ProxySection /> : null}
          {section === 'permissions' ? <PermissionsSection /> : null}
          {section === 'about' ? <AboutSection /> : null}
        </motion.div>
      </div>
    </div>
  )
}
