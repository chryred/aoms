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
        'bg-bg-base rounded-sm p-6 transition-shadow',
        pressed
          ? 'shadow-neu-inset'
          : severity === 'critical'
            ? 'shadow-glow-critical'
            : severity === 'warning'
              ? 'shadow-glow-warning'
              : 'shadow-neu-flat',
        severity === 'critical' && 'bg-critical-card-bg',
        severity === 'warning' && 'bg-warning-card-bg',
        onClick && [
          'cursor-pointer',
          'hover:shadow-neu-flat-hover',
          'focus-visible:ring-accent focus-visible:ring-offset-bg-base focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        ],
        className,
      )}
    >
      {children}
    </div>
  )
}
