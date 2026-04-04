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
          <label htmlFor={id} className="text-[0.8125rem] font-medium text-[#8B97AD]">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8B97AD]">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            className={cn(
              'w-full rounded-xl bg-[#1E2127]',
              'border border-[#2B2F37]',
              'shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37]',
              'px-4 py-2.5 text-sm text-[#E2E8F2] placeholder:text-[#5A6478]',
              'focus:outline-none focus:ring-2 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              leftIcon && 'pl-10',
              error && 'border-[#EF4444] focus:ring-[#EF4444]',
              className
            )}
            {...props}
          />
        </div>
        {error && <p className="text-xs text-[#F87171]">{error}</p>}
      </div>
    )
  }
)
NeuInput.displayName = 'NeuInput'
