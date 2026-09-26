import { motion, useReducedMotion } from 'motion/react'
import type { VoiceState } from '@shared/events'
import { cn } from '../../lib/cn'

/**
 * Vivi's animated orb. `level` (0..1) drives the pulse amplitude while listening/speaking.
 */
export function Orb({ state, level = 0, size = 96, className }: { state: VoiceState | 'thinking' | 'idle'; level?: number; size?: number; className?: string }) {
  const reduce = useReducedMotion()
  const active = state === 'listening' || state === 'speaking'
  const thinking = state === 'thinking' || state === 'transcribing'
  const amp = Math.min(1, Math.max(0, level))
  const scale = active ? 1 + amp * 0.35 : 1
  const glow = active ? 0.55 + amp * 0.45 : thinking ? 0.5 : 0.3

  return (
    <div className={cn('relative grid place-items-center', className)} style={{ width: size, height: size }}>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ background: 'radial-gradient(circle at 35% 30%, var(--accent-2), var(--accent) 60%, transparent 72%)', filter: 'blur(14px)' }}
        animate={{ opacity: glow, scale: reduce ? 1 : active ? scale * 1.15 : thinking ? [1, 1.12, 1] : [1, 1.05, 1] }}
        transition={active ? { type: 'spring', stiffness: 220, damping: 18 } : { duration: thinking ? 1.2 : 3.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="relative rounded-full"
        style={{
          width: size * 0.62,
          height: size * 0.62,
          background: 'radial-gradient(circle at 32% 28%, #ffffff 0%, var(--accent-2) 22%, var(--accent) 70%, #2a1f7a 100%)',
          boxShadow: '0 10px 30px -10px var(--accent)',
        }}
        animate={{ scale: reduce ? 1 : active ? scale : thinking ? [1, 0.94, 1] : [1, 1.03, 1], rotate: thinking && !reduce ? 360 : 0 }}
        transition={active ? { type: 'spring', stiffness: 260, damping: 16 } : { duration: thinking ? 1.6 : 4, repeat: Infinity, ease: thinking ? 'linear' : 'easeInOut' }}
      />
      {state === 'error' ? <div className="absolute inset-0 rounded-full ring-2 ring-danger/70" /> : null}
    </div>
  )
}
