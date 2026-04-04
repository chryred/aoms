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
          <label htmlFor={id} className="text-sm font-medium text-[#1A1F2E]">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A5568]">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            className={cn(
              'w-full rounded-xl bg-[#E8EBF0]',
              'border border-[#C0C4CF]',
              'shadow-[inset_4px_4px_8px_#C8CBD4,inset_-4px_-4px_8px_#FFFFFF]',
              'px-4 py-2.5 text-sm text-[#1A1F2E] placeholder:text-[#A0A4B0]',
              'focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              leftIcon && 'pl-10',
              error && 'border-[#DC2626] focus:ring-[#DC2626]',
              className
            )}
            {...props}
          />
        </div>
        {error && <p className="text-xs text-[#DC2626]">{error}</p>}
      </div>
    )
  }
)
NeuInput.displayName = 'NeuInput'
