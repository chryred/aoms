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
    <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-[#E8EBF0] shadow-[inset_2px_2px_4px_#C8CBD4,inset_-2px_-2px_4px_#FFFFFF]">
      {PERIODS.map(period => (
        <button
          key={period}
          onClick={() => onChange(period)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
            'focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-1',
            value === period
              ? 'bg-[#6366F1] text-white shadow-[2px_2px_4px_#C8CBD4]'
              : 'text-[#4A5568] hover:text-[#1A1F2E]'
          )}
        >
          {PERIOD_LABELS[period]}
        </button>
      ))}
    </div>
  )
}
