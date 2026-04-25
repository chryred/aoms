import { cn } from '@/lib/utils'
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  /** 스크린리더용 라벨. icon-only 버튼은 필수. */
  'aria-label': string
  size?: 'sm' | 'md'
  /** hover 시 강조할 의미적 색상. 기본 text-primary. */
  tone?: 'default' | 'critical'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, className, size = 'md', tone = 'default', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'text-text-secondary focus:ring-accent inline-flex items-center justify-center rounded-sm',
        'focus:ring-1 focus:outline-none',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' && 'h-8 w-8',
        size === 'md' && 'h-10 w-10',
        tone === 'default' && 'hover:text-text-primary',
        tone === 'critical' && 'hover:text-critical',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})
