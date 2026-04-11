import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface NeuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'glass' | 'ghost' | 'danger'
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
        'inline-flex items-center justify-center gap-2 rounded-sm font-medium',
        'transition-[box-shadow,background-color,opacity] duration-150',
        'focus:ring-1 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127] focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-6 py-3 text-base',
        variant === 'primary' && [
          'bg-[#00D4FF] font-semibold text-[#1E2127]',
          'shadow-[2px_2px_5px_#111317,-2px_-2px_5px_#2B2F37]',
          'hover:bg-[#00B8E0]',
          'active:bg-[#00B8E0] active:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3)]',
        ],
        variant === 'secondary' && [
          'bg-[#2A3447]/60 text-[#E2E8F2]',
          'shadow-[2px_2px_5px_#111317,-2px_-2px_5px_#2B2F37]',
          'hover:bg-[#2A3447]/80 hover:text-[#E2E8F2]',
          'active:bg-[#2A3447]/90 active:shadow-[inset_1px_1px_4px_rgba(0,0,0,0.2)]',
        ],
        variant === 'glass' && [
          'bg-[rgba(0,212,255,0.08)] text-[#00D4FF]',
          'border border-[rgba(0,212,255,0.16)] backdrop-blur-sm',
          'hover:bg-[rgba(0,212,255,0.14)]',
          'active:bg-[rgba(0,212,255,0.20)]',
        ],
        variant === 'ghost' && [
          'text-[#8B97AD] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#E2E8F2]',
          'active:bg-[rgba(255,255,255,0.08)]',
        ],
        variant === 'danger' && [
          'bg-[#EF4444] text-white',
          'shadow-[2px_2px_5px_#111317,-2px_-2px_5px_#2B2F37]',
          'hover:bg-[#DC2626]',
          'active:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3)]',
        ],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}
