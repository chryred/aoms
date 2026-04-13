import { cn } from '@/lib/utils'
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'

interface NeuInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  leftIcon?: ReactNode
}

export const NeuInput = forwardRef<HTMLInputElement, NeuInputProps>(
  ({ label, error, leftIcon, className, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-text-secondary text-[0.8125rem] font-medium">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span className="text-text-secondary absolute top-1/2 left-3 -translate-y-1/2">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            className={cn(
              'bg-bg-base w-full rounded-sm',
              'border-border border',
              'shadow-neu-inset',
              'text-text-primary placeholder:text-text-disabled px-4 py-2.5 text-sm',
              'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:ring-offset-2 focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-40',
              leftIcon && 'pl-10',
              error && 'border-critical focus:ring-critical',
              className,
            )}
            {...props}
          />
        </div>
        {error && <p className="text-critical-text text-xs">{error}</p>}
      </div>
    )
  },
)
NeuInput.displayName = 'NeuInput'
