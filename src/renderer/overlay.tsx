import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './i18n'
import { OverlayRoot } from './features/overlay/OverlayRoot'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayRoot />
  </StrictMode>,
)
