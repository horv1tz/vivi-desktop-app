import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './styles/globals.css'
import './i18n'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {/* UX-07: the CSS-only `prefers-reduced-motion` rule in globals.css only zeroes plain CSS
          transitions/animations — it has no effect on motion/react's own spring-driven
          initial/animate/exit props, which is how virtually every animated surface in this app
          (sidebar, dialogs, tool cards, onboarding) actually animates. `reducedMotion="user"`
          makes every motion.* component in the tree honor the OS setting automatically. */}
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
)
