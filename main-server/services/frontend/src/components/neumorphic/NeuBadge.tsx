import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

type BadgeVariant = 'critical' | 'warning' | 'normal' | 'info' | 'muted'

interface NeuBadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantMap: Record<BadgeVariant, string> = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  warning: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  normal: 'bg-green-100 text-green-700 border border-green-200',
  info: 'bg-blue-100 text-blue-700 border border-blue-200',
  muted: 'bg-gray-100 text-gray-600 border border-gray-200',
}

export function NeuBadge({ children, variant = 'muted', className }: NeuBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        variantMap[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
