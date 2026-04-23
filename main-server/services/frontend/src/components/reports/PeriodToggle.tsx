import { cn } from '@/lib/utils'
import type { ReportType } from '@/types/report'

interface PeriodToggleProps {
  value: ReportType
  onChange: (period: ReportType) => void
}

const PERIOD_LABELS: Record<ReportType, string> = {
  daily: '일별',
  weekly: '주별',
  monthly: '월별',
  quarterly: '분기',
  half_year: '반기',
  annual: '연간',
}

const PERIODS: ReportType[] = ['daily', 'weekly', 'monthly', 'quarterly', 'half_year', 'annual']

export function PeriodToggle({ value, onChange }: PeriodToggleProps) {
  return (
    <div
      role="group"
      aria-label="집계 기간 선택"
      className="bg-bg-base shadow-neu-pressed flex flex-wrap gap-1 rounded-sm p-1.5"
    >
      {PERIODS.map((period) => (
        <button
          key={period}
          onClick={() => onChange(period)}
          aria-pressed={value === period}
          className={cn(
            'px-3 py-3 text-sm font-medium transition-all',
            'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:ring-offset-1 focus:outline-none',
            value === period
              ? 'border-accent bg-accent text-accent-contrast shadow-neu-pressed rounded-t-[2px] rounded-b-none border-b-2 font-semibold'
              : 'text-text-secondary hover:bg-hover-subtle hover:text-text-primary hover:ring-accent-muted rounded-[2px] hover:ring-1',
          )}
        >
          {PERIOD_LABELS[period]}
        </button>
      ))}
    </div>
  )
}
