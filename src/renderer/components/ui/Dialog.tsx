import type { ReactNode } from 'react'
import { Dialog as RadixDialog } from 'radix-ui'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '../../lib/cn'

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  dismissable = true,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
  dismissable?: boolean
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content
              asChild
              onEscapeKeyDown={(e) => !dismissable && e.preventDefault()}
              onPointerDownOutside={(e) => !dismissable && e.preventDefault()}
            >
              <motion.div
                className={cn(
                  'fixed left-1/2 top-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-elev p-6 shadow-[var(--shadow)] border border-line',
                  className,
                )}
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 6 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              >
                <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
                {description ? (
                  <RadixDialog.Description className="mt-1 text-sm text-muted">
                    {description}
                  </RadixDialog.Description>
                ) : (
                  <RadixDialog.Description className="sr-only">dialog</RadixDialog.Description>
                )}
                <div className="mt-4">{children}</div>
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  )
}
