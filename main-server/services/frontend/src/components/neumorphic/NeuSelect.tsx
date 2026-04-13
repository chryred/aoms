import { cn } from '@/lib/utils'
import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'

interface NeuSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}

export const NeuSelect = forwardRef<HTMLSelectElement, NeuSelectProps>(
  ({ label, error, className, id, children, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-text-secondary text-[0.8125rem] font-medium">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={id}
            className={cn(
              'bg-bg-base w-full appearance-none rounded-sm',
              'border-border border',
              'shadow-neu-inset',
              'text-text-primary px-4 py-2.5 pr-10 text-sm',
              'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:ring-offset-2 focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-40',
              error && 'border-critical focus:ring-critical',
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown className="text-text-secondary pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2" />
        </div>
        {error && <p className="text-critical-text text-xs">{error}</p>}
      </div>
    )
  },
)
NeuSelect.displayName = 'NeuSelect'
