import { CheckCircle2, Circle, AlertCircle, Search, Wrench, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NextActionMeta, IncidentStatus } from '@/api/incidents'

interface NextActionCardProps {
  meta: NextActionMeta
  className?: string
}

// status별 아이콘 (시각적 단서)
const STATUS_ICON: Record<IncidentStatus, typeof Circle> = {
  open: AlertCircle,
  acknowledged: Circle,
  investigating: Search,
  resolved: Wrench,
  closed: CheckCircle2,
}

// status별 강조 색상 토큰 (디자인 시스템 정합)
const STATUS_TONE: Record<IncidentStatus, { iconClass: string; barClass: string }> = {
  open: { iconClass: 'text-critical', barClass: 'bg-critical' },
  acknowledged: { iconClass: 'text-warning', barClass: 'bg-warning' },
  investigating: { iconClass: 'text-warning', barClass: 'bg-warning' },
  resolved: { iconClass: 'text-normal', barClass: 'bg-normal' },
  closed: { iconClass: 'text-text-secondary', barClass: 'bg-text-secondary' },
}

export function NextActionCard({ meta, className }: NextActionCardProps) {
  const Icon = STATUS_ICON[meta.status] ?? Circle
  const tone = STATUS_TONE[meta.status] ?? STATUS_TONE.open
  const pct = Math.max(0, Math.min(100, meta.progress_pct))

  return (
    <div
      className={cn('bg-surface shadow-neu-flat rounded-sm p-4', className)}
      role="region"
      aria-label="인시던트 다음 액션 가이드"
    >
      {/* 헤더: 아이콘 + 상태 라벨 + 진행률 */}
      <div className="mb-3 flex items-center gap-2">
        <Icon className={cn('h-5 w-5 shrink-0', tone.iconClass)} aria-hidden="true" />
        <div className="flex-1">
          <div className="text-text-primary text-sm font-semibold">현재 단계: {meta.status_ko}</div>
          <div className="text-text-secondary text-[11px]">진행률 {pct}%</div>
        </div>
      </div>

      {/* 진행률 바 (뉴모피즘 inset 트랙 + 컬러 fill) */}
      <div className="bg-bg-deep shadow-neu-inset mb-3 h-1.5 w-full overflow-hidden rounded-sm">
        <div
          className={cn('h-full transition-[width] duration-300 ease-out', tone.barClass)}
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>

      {/* 권장 액션 본문 */}
      <div className="border-border border-t pt-3">
        <div className="text-text-secondary mb-1 flex items-center gap-1 text-[11px] tracking-wide uppercase">
          <FileText className="h-3 w-3" aria-hidden="true" />
          <span>다음 권장 액션</span>
        </div>
        <p className="text-text-primary text-sm leading-relaxed">{meta.next_action}</p>
      </div>
    </div>
  )
}
