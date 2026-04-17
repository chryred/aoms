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
        'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:ring-offset-2 focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' && 'min-h-[32px] px-3 py-1.5 text-sm',
        size === 'md' && 'min-h-[40px] px-4 py-2 text-sm',
        size === 'lg' && 'min-h-[48px] px-6 py-3 text-base',
        variant === 'primary' && [
          'bg-accent text-accent-contrast font-semibold',
          'shadow-neu-flat',
          'hover:bg-accent-hover',
          'active:bg-accent-hover active:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3)]',
        ],
        variant === 'secondary' && [
          'bg-btn-secondary text-text-primary',
          'shadow-neu-flat',
          'hover:bg-btn-secondary hover:text-text-primary',
          'active:bg-btn-secondary active:shadow-[inset_1px_1px_4px_rgba(0,0,0,0.2)]',
        ],
        variant === 'glass' && [
          'bg-glass-bg text-accent',
          'border-glass-border border backdrop-blur-sm',
          'hover:bg-[rgba(0,212,255,0.14)]',
          'active:bg-[rgba(0,212,255,0.20)]',
        ],
        variant === 'ghost' && [
          'text-text-secondary hover:bg-hover-subtle hover:text-text-primary',
          'active:bg-[rgba(255,255,255,0.08)]',
        ],
        variant === 'danger' && [
          'bg-critical text-white',
          'shadow-neu-flat',
          'hover:bg-critical',
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
