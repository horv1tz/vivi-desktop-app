import { Switch as RadixSwitch } from 'radix-ui'
import { cn } from '../../lib/cn'

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'no-drag relative h-6 w-11 shrink-0 rounded-full border border-line-strong bg-sunken transition-colors data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        className,
      )}
    >
      <RadixSwitch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform duration-200 data-[state=checked]:translate-x-[22px]" />
    </RadixSwitch.Root>
  )
}
