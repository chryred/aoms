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
          <label htmlFor={id} className="text-[0.8125rem] font-medium text-[#8B97AD]">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={id}
            className={cn(
              'w-full appearance-none rounded-sm bg-[#1E2127] [color-scheme:dark]',
              'border border-[#2B2F37]',
              'shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37]',
              'px-4 py-2.5 pr-10 text-sm text-[#E2E8F2]',
              'focus:ring-1 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127] focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-40',
              error && 'border-[#EF4444] focus:ring-[#EF4444]',
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-[#8B97AD]" />
        </div>
        {error && <p className="text-xs text-[#F87171]">{error}</p>}
      </div>
    )
  },
)
NeuSelect.displayName = 'NeuSelect'
