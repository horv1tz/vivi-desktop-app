import { useEffect } from 'react'
import { useSettingsStore } from '../../stores/settings'
import { ControlHud } from './ControlHud'

export function ControlHudRoot() {
  const load = useSettingsStore((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])
  return <ControlHud />
}
