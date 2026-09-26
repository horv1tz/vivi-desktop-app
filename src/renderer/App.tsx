import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { AppInfo } from '@shared/events'
import { invoke } from './lib/bridge'
import { useSettingsStore } from './stores/settings'
import { useChatStore } from './stores/chat'
import { useUiStore } from './stores/ui'
import { TitleBar } from './features/layout/TitleBar'
import { Sidebar } from './features/layout/Sidebar'
import { ChatView } from './features/chat/ChatView'
import { SettingsView } from './features/settings/SettingsView'
import { PermissionDialog } from './features/permissions/PermissionDialog'
import { QuestionDialog } from './features/permissions/QuestionDialog'
import { OnboardingView } from './features/onboarding/OnboardingView'

export function App() {
  const loaded = useSettingsStore((s) => s.loaded)
  const load = useSettingsStore((s) => s.load)
  const hydrate = useChatStore((s) => s.hydrate)
  const view = useUiStore((s) => s.view)
  const onboardingCompleted = useSettingsStore((s) => s.settings.onboardingCompleted)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void load()
    void hydrate()
    invoke('app:getInfo').then(setInfo).catch(() => null)
  }, [load, hydrate])

  if (!loaded) return <div className="h-full bg-bg" />

  if (!onboardingCompleted && view !== 'settings') {
    return (
      <div className="flex h-full flex-col bg-bg text-fg">
        <TitleBar />
        <OnboardingView />
        <PermissionDialog />
        <QuestionDialog />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={view} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {view === 'settings' ? <SettingsView /> : <ChatView mockAgent={info?.mockAgent ?? false} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <PermissionDialog />
      <QuestionDialog />
    </div>
  )
}
