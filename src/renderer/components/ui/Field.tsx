import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Field({
  label,
  hint,
  children,
  className,
  inline,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
  inline?: boolean
}) {
  return (
    <label
      className={cn('flex gap-3', inline ? 'items-center justify-between' : 'flex-col', className)}
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-fg">{label}</span>
        {hint ? <span className="text-xs text-faint">{hint}</span> : null}
      </span>
      {children}
    </label>
  )
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'no-drag h-9 w-full rounded-xl border border-line bg-sunken px-3 text-sm text-fg outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/30 selectable',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'no-drag w-full rounded-xl border border-line bg-sunken px-3 py-2 text-sm text-fg outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/30 selectable',
        className,
      )}
      {...props}
    />
  )
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'no-drag h-9 rounded-xl border border-line bg-sunken px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Section({
  title,
  description,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-card border border-line bg-elev p-5 shadow-[0_1px_0_var(--border)]">
      <header className="mb-4">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}
