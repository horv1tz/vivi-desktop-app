import { useEffect } from 'react'
import { useSettingsStore } from '../../stores/settings'
import { useChatStore } from '../../stores/chat'
import { OverlayView } from './OverlayView'
import { PermissionDialog } from '../permissions/PermissionDialog'
import { QuestionDialog } from '../permissions/QuestionDialog'

export function OverlayRoot() {
  const loaded = useSettingsStore((s) => s.loaded)
  const load = useSettingsStore((s) => s.load)
  const hydrate = useChatStore((s) => s.hydrate)
  useEffect(() => {
    void load()
    void hydrate()
  }, [load, hydrate])
  if (!loaded) return null
  return (
    <>
      <OverlayView />
      <PermissionDialog />
      <QuestionDialog />
    </>
  )
}
