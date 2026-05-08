import { cn } from '@/lib/utils'

interface SeverityBadgeProps {
  severity: string
  size?: 'sm' | 'md'
}

const colorMap: Record<string, string> = {
  normal: 'text-normal bg-normal-bg',
  warning: 'text-warning-text bg-warning-bg',
  critical: 'text-critical-text bg-critical-bg',
  info: 'text-accent bg-accent-muted',
}

const labelMap: Record<string, string> = {
  normal: '정상',
  warning: '경고',
  critical: '위험',
  info: '정보',
}

export function SeverityBadge({ severity, size = 'sm' }: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        colorMap[severity] ?? colorMap.normal,
      )}
    >
      {labelMap[severity] ?? severity}
    </span>
  )
}
