import { cn } from '@/lib/utils'
import { forwardRef, type TextareaHTMLAttributes } from 'react'

interface NeuTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const NeuTextarea = forwardRef<HTMLTextAreaElement, NeuTextareaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-text-secondary text-[0.8125rem] font-medium">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={cn(
            'bg-bg-base w-full rounded-sm',
            'border-border border',
            'shadow-neu-inset',
            'text-text-primary placeholder:text-text-disabled px-4 py-2.5 text-sm',
            'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:ring-offset-2 focus:outline-none',
            'resize-none disabled:cursor-not-allowed disabled:opacity-40',
            error && 'border-critical focus:ring-critical',
            className,
          )}
          {...props}
        />
        {error && <p className="text-critical-text text-xs">{error}</p>}
      </div>
    )
  },
)
NeuTextarea.displayName = 'NeuTextarea'
