import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

type BadgeVariant = 'critical' | 'warning' | 'normal' | 'info' | 'muted'

interface NeuBadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantMap: Record<BadgeVariant, string> = {
  critical: 'bg-critical-bg text-critical-text border border-critical-border',
  warning: 'bg-warning-bg text-warning-text border border-warning-border',
  normal: 'bg-normal-bg text-normal-text border border-normal-border',
  info: 'bg-accent-muted text-accent border border-accent-muted',
  muted: 'bg-muted-bg text-text-secondary border border-muted-border',
}

export function NeuBadge({ children, variant = 'muted', className }: NeuBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        variantMap[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
