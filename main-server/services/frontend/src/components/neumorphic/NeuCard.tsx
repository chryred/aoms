import { cn } from '@/lib/utils'
import type { ReactNode, KeyboardEvent } from 'react'

interface NeuCardProps {
  children: ReactNode
  className?: string
  severity?: 'normal' | 'warning' | 'critical'
  pressed?: boolean
  onClick?: () => void
}

export function NeuCard({ children, className, severity, pressed, onClick }: NeuCardProps) {
  const handleKeyDown = onClick
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }
    : undefined

  return (
    <div
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'rounded-sm bg-[#1E2127] p-6 transition-shadow',
        pressed
          ? 'shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37]'
          : 'shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]',
        severity === 'critical' && 'border-l-4 border-l-[#EF4444] bg-[rgba(239,68,68,0.06)]',
        severity === 'warning' && 'border-l-4 border-l-[#F59E0B] bg-[rgba(245,158,11,0.04)]',
        onClick && [
          'cursor-pointer',
          'hover:shadow-[4px_4px_10px_#111317,-4px_-4px_10px_#2B2F37]',
          'focus-visible:ring-2 focus-visible:ring-[#00D4FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1E2127] focus-visible:outline-none',
        ],
        className,
      )}
    >
      {children}
    </div>
  )
}
