import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './styles/globals.css'
import './i18n'
import { OverlayRoot } from './features/overlay/OverlayRoot'
import { ControlHudRoot } from './features/overlay/ControlHudRoot'
import { LauncherRoot } from './features/overlay/LauncherRoot'
import { ErrorBoundary } from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {/* UX-07: see main.tsx — same reasoning, and this window's orb/waveform animations are the
          heaviest user of motion/react in the whole app. */}
      <MotionConfig reducedMotion="user">
        {location.hash === '#hud' ? (
          <ControlHudRoot />
        ) : location.hash === '#launcher' ? (
          <LauncherRoot />
        ) : (
          <OverlayRoot />
        )}
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
)
