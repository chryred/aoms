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
// barClass는 제거 — 진행률 바는 accent 단색으로 통일 (정보 중복 방지)
const STATUS_TONE: Record<IncidentStatus, { iconClass: string }> = {
  open: { iconClass: 'text-critical' },
  acknowledged: { iconClass: 'text-warning' },
  investigating: { iconClass: 'text-warning' },
  resolved: { iconClass: 'text-normal' },
  closed: { iconClass: 'text-text-secondary' },
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
        <div className="flex flex-1 items-center justify-between gap-2">
          <div className="text-text-primary text-sm font-semibold">현재 단계: {meta.status_ko}</div>
          <div className="text-text-secondary text-xs tabular-nums">{pct}%</div>
        </div>
      </div>

      {/* 진행률 바 (뉴모피즘 inset 트랙 + 컬러 fill) */}
      <div
        className="bg-bg-deep shadow-neu-inset mb-3 h-1.5 w-full overflow-hidden rounded-sm"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`인시던트 진행률 ${pct}퍼센트, 현재 단계 ${meta.status_ko}`}
      >
        <div
          className="bg-accent h-full w-full origin-left transition-transform duration-300 ease-out"
          style={{ transform: `scaleX(${pct / 100})`, transformOrigin: 'left' }}
          aria-hidden="true"
        />
      </div>

      {/* 권장 액션 본문 */}
      <div className="border-border border-t pt-3">
        <div className="text-text-secondary mb-1 flex items-center gap-1 text-xs tracking-wide uppercase">
          <FileText className="h-3 w-3" aria-hidden="true" />
          <span>다음 권장 액션</span>
        </div>
        <p className="text-text-primary text-sm leading-relaxed font-medium">{meta.next_action}</p>
      </div>
    </div>
  )
}
