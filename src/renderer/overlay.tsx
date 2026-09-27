import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './i18n'
import { OverlayRoot } from './features/overlay/OverlayRoot'
import { ControlHudRoot } from './features/overlay/ControlHudRoot'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{location.hash === '#hud' ? <ControlHudRoot /> : <OverlayRoot />}</StrictMode>,
)
