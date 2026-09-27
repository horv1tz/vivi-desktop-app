import { useState } from 'react'
import { invoke } from '../../lib/bridge'
import { Orb } from '../../components/motion/Orb'

/** WORK-04: the floating quick-access button's entire window content — a single click surface. */
export function LauncherRoot() {
  const [hover, setHover] = useState(false)

  return (
    <button
      type="button"
      className="grid h-full w-full cursor-pointer place-items-center bg-transparent"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => void invoke('window:toggleOverlay')}
      title="Vivi"
      aria-label="Vivi"
    >
      <Orb state="idle" size={hover ? 44 : 38} />
    </button>
  )
}
