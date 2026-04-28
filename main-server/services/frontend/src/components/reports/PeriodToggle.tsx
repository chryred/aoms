import { useRef, useEffect, useState } from 'react'
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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  useEffect(() => {
    const idx = PERIODS.indexOf(value)
    const btn = tabRefs.current[idx]
    if (!btn) return
    const { offsetLeft: left, offsetWidth: width } = btn
    setIndicator((prev) => ({ left, width, ready: prev.ready }))
    if (!indicator.ready) {
      requestAnimationFrame(() => setIndicator({ left, width, ready: true }))
    }
  }, [value, indicator.ready])

  return (
    <div
      role="group"
      aria-label="집계 기간 선택"
      className="bg-bg-base shadow-neu-pressed relative flex gap-1 rounded-sm p-1"
    >
      <span
        aria-hidden="true"
        className="shadow-neu-flat bg-accent pointer-events-none absolute rounded-sm"
        style={{
          top: 4,
          bottom: 4,
          left: indicator.left,
          width: indicator.width,
          opacity: indicator.ready ? 1 : 0,
          transition: indicator.ready
            ? 'left 0.22s cubic-bezier(0.25, 1, 0.5, 1), width 0.22s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.12s ease'
            : 'none',
        }}
      />
      {PERIODS.map((period, i) => (
        <button
          key={period}
          ref={(el) => {
            tabRefs.current[i] = el
          }}
          onClick={() => onChange(period)}
          aria-pressed={value === period}
          className={cn(
            'relative z-10 rounded-sm px-4 py-2.5 text-sm font-medium',
            'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:outline-none',
            'transition-colors duration-150',
            value === period
              ? 'text-accent-contrast font-semibold'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {PERIOD_LABELS[period]}
        </button>
      ))}
    </div>
  )
}
