import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface NeuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'glass' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export function NeuButton({
  children,
  variant = 'primary',
  size = 'md',
  loading,
  className,
  disabled,
  ...props
}: NeuButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all',
        'focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-6 py-3 text-base',
        variant === 'primary' && [
          'bg-[#6366F1] text-white',
          'shadow-[3px_3px_6px_#C8CBD4,-3px_-3px_6px_#FFFFFF]',
          'hover:bg-[#4F46E5] active:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.2)]',
        ],
        variant === 'glass' && [
          'bg-[rgba(99,102,241,0.10)] text-[#6366F1]',
          'border border-[rgba(99,102,241,0.20)] backdrop-blur-sm',
          'hover:bg-[rgba(99,102,241,0.18)]',
        ],
        variant === 'ghost' && [
          'text-[#4A5568] hover:bg-[rgba(0,0,0,0.05)]',
        ],
        variant === 'danger' && [
          'bg-[#DC2626] text-white',
          'shadow-[3px_3px_6px_#C8CBD4,-3px_-3px_6px_#FFFFFF]',
          'hover:bg-[#B91C1C]',
        ],
        className
      )}
      {...props}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  )
}
