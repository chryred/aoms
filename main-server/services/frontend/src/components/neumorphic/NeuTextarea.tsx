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
          <label htmlFor={id} className="text-sm font-medium text-[#1A1F2E]">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={cn(
            'w-full rounded-xl bg-[#E8EBF0]',
            'border border-[#C0C4CF]',
            'shadow-[inset_4px_4px_8px_#C8CBD4,inset_-4px_-4px_8px_#FFFFFF]',
            'px-4 py-2.5 text-sm text-[#1A1F2E] placeholder:text-[#A0A4B0]',
            'focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2',
            'resize-none disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-[#DC2626] focus:ring-[#DC2626]',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-[#DC2626]">{error}</p>}
      </div>
    )
  }
)
NeuTextarea.displayName = 'NeuTextarea'
