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
    <div className="flex flex-wrap gap-1 p-1.5 rounded-sm bg-[#1E2127] shadow-[inset_1px_1px_3px_#111317,inset_-1px_-1px_3px_#2B2F37]">
      {PERIODS.map(period => (
        <button
          key={period}
          onClick={() => onChange(period)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium transition-all',
            'focus:outline-none focus:ring-1 focus:ring-[#00D4FF] focus:ring-offset-1 focus:ring-offset-[#1E2127]',
            value === period
              ? 'rounded-t-[2px] rounded-b-none bg-[#252932] text-white font-semibold shadow-[2px_2px_4px_#111317,-1px_-1px_3px_#2B2F37] border-b-2 border-[#00D4FF]'
              : 'rounded-[2px] text-[#8B97AD] hover:text-[#E2E8F2] hover:bg-[rgba(255,255,255,0.05)] hover:ring-1 hover:ring-[#00D4FF4D]'
          )}
        >
          {PERIOD_LABELS[period]}
        </button>
      ))}
    </div>
  )
}
