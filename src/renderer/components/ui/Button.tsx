import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 shadow-[0_6px_20px_-8px_var(--accent)]',
  secondary: 'bg-sunken text-fg hover:bg-line-strong/40 border border-line',
  ghost: 'text-muted hover:text-fg hover:bg-line/60',
  danger: 'bg-danger text-white hover:brightness-110',
  outline: 'border border-line-strong text-fg hover:bg-line/40',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg gap-1.5',
  md: 'h-9 px-4 text-sm rounded-xl gap-2',
  lg: 'h-11 px-5 text-[15px] rounded-2xl gap-2',
  icon: 'h-9 w-9 rounded-xl',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'no-drag inline-flex items-center justify-center font-medium transition-[background,transform,filter,color] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
})
