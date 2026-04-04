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
          <label htmlFor={id} className="text-sm font-medium text-[#1A1F2E]">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={id}
            className={cn(
              'w-full appearance-none rounded-xl bg-[#E8EBF0]',
              'border border-[#C0C4CF]',
              'shadow-[inset_4px_4px_8px_#C8CBD4,inset_-4px_-4px_8px_#FFFFFF]',
              'px-4 py-2.5 pr-10 text-sm text-[#1A1F2E]',
              'focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              error && 'border-[#DC2626] focus:ring-[#DC2626]',
              className
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4A5568]" />
        </div>
        {error && <p className="text-xs text-[#DC2626]">{error}</p>}
      </div>
    )
  }
)
NeuSelect.displayName = 'NeuSelect'
