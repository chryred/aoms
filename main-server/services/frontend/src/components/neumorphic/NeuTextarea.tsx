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
          <label htmlFor={id} className="text-[0.8125rem] font-medium text-[#8B97AD]">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={cn(
            'w-full rounded-xl bg-[#1E2127]',
            'border border-[#2B2F37]',
            'shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37]',
            'px-4 py-2.5 text-sm text-[#E2E8F2] placeholder:text-[#5A6478]',
            'focus:outline-none focus:ring-2 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127]',
            'resize-none disabled:opacity-40 disabled:cursor-not-allowed',
            error && 'border-[#EF4444] focus:ring-[#EF4444]',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-[#F87171]">{error}</p>}
      </div>
    )
  }
)
NeuTextarea.displayName = 'NeuTextarea'
