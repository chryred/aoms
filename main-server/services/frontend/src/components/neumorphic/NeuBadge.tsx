import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

type BadgeVariant = 'critical' | 'warning' | 'normal' | 'info' | 'muted'

interface NeuBadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantMap: Record<BadgeVariant, string> = {
  critical: 'bg-[rgba(239,68,68,0.12)] text-[#F87171] border border-[rgba(239,68,68,0.25)]',
  warning: 'bg-[rgba(245,158,11,0.12)] text-[#FCD34D] border border-[rgba(245,158,11,0.25)]',
  normal: 'bg-[rgba(34,197,94,0.12)] text-[#4ADE80] border border-[rgba(34,197,94,0.25)]',
  info: 'bg-[rgba(0,212,255,0.10)] text-[#00D4FF] border border-[rgba(0,212,255,0.20)]',
  muted: 'bg-[rgba(255,255,255,0.06)] text-[#8B97AD] border border-[rgba(255,255,255,0.10)]',
}

export function NeuBadge({ children, variant = 'muted', className }: NeuBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variantMap[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
