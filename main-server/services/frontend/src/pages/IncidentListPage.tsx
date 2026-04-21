import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronUp, ChevronDown, ChevronRight } from 'lucide-react'
import { useIncidents } from '@/hooks/queries/useIncidents'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { ROUTES } from '@/constants/routes'
import { formatRelative, cn } from '@/lib/utils'
import type { IncidentOut } from '@/api/incidents'

type StatusFilter = 'all' | 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'closed'
type SortKey = 'severity' | 'status' | 'detected_at'
type SortDir = 'asc' | 'desc'

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1 }
const STATUS_ORDER: Record<string, number> = {
  open: 0,
  acknowledged: 1,
  investigating: 2,
  resolved: 3,
  closed: 4,
}

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'open', label: '신규' },
  { key: 'acknowledged', label: '확인됨' },
  { key: 'investigating', label: '조사 중' },
  { key: 'resolved', label: '해결됨' },
  { key: 'closed', label: '종료' },
]

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-critical/15 text-critical border-critical/30',
  acknowledged: 'bg-warning/15 text-warning border-warning/30',
  investigating: 'bg-accent/15 text-accent border-accent/30',
  resolved: 'bg-normal/15 text-normal border-normal/30',
  closed: 'bg-surface text-text-disabled border-border',
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'text-critical',
  warning: 'text-warning',
}

function StatusBadge({ status }: { status: string }) {
  const LABELS: Record<string, string> = {
    open: '신규',
    acknowledged: '확인됨',
    investigating: '조사 중',
    resolved: '해결됨',
    closed: '종료',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[status] ?? 'bg-surface text-text-secondary border-border',
      )}
    >
      {LABELS[status] ?? status}
    </span>
  )
}

function MttrBadge({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span className="text-text-disabled">—</span>
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const label = h > 0 ? `${h}h ${m}m` : `${m}m`
  return <span className="whitespace-nowrap tabular-nums text-text-secondary">{label}</span>
}

export function IncidentListPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('detected_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const {
    data: incidents = [],
    isLoading,
    isError,
  } = useIncidents(statusFilter !== 'all' ? { status: statusFilter, limit: 100 } : { limit: 100 })

  const openCount = incidents.filter((i) => i.status === 'open').length

  const sortedIncidents = useMemo(() => {
    return [...incidents].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'severity') {
        cmp = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
      } else if (sortKey === 'status') {
        cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
      } else {
        cmp = a.detected_at < b.detected_at ? -1 : a.detected_at > b.detected_at ? 1 : 0
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [incidents, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronUp className="text-text-disabled ml-1 inline h-3 w-3 opacity-30" />
    return sortDir === 'asc'
      ? <ChevronUp className="text-accent ml-1 inline h-3 w-3" />
      : <ChevronDown className="text-accent ml-1 inline h-3 w-3" />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="인시던트 관리"
        description="알림·로그 분석을 사건 단위로 추적하고 MTTR을 측정합니다"
        action={
          openCount > 0 ? (
            <span className="bg-critical/15 text-critical border-critical/30 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              미해결 {openCount}건
            </span>
          ) : undefined
        }
      />

      {/* 상태 탭 */}
      <NeuCard className="overflow-x-auto">
        <div role="tablist" aria-label="인시던트 상태 필터" className="flex gap-1">
          {STATUS_TABS.map((tab) => (
            <NeuButton
              key={tab.key}
              size="sm"
              variant={statusFilter === tab.key ? 'primary' : 'ghost'}
              role="tab"
              aria-selected={statusFilter === tab.key}
              onClick={() => setStatusFilter(tab.key)}
            >
              {tab.label}
            </NeuButton>
          ))}
        </div>
      </NeuCard>

      {isLoading && <LoadingSkeleton shape="table" count={6} />}
      {isError && <ErrorCard message="인시던트 목록을 불러오지 못했습니다" />}

      {!isLoading && !isError && incidents.length === 0 && (
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" aria-hidden />}
          title="인시던트 없음"
          description="해당 조건의 인시던트가 없습니다"
        />
      )}

      {!isLoading && incidents.length > 0 && (
        <NeuCard className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-text-secondary border-b">
                  <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">#</th>
                  <th className="px-4 py-2.5 text-left font-medium">제목</th>
                  <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">시스템</th>
                  <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">심각도</th>
                  <th className="px-4 py-2.5 text-left font-medium">상태</th>
                  <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell whitespace-nowrap">알림 수</th>
                  <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">MTTR</th>
                  <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">감지</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident: IncidentOut) => (
                  <tr
                    key={incident.id}
                    className="border-border/50 hover:bg-surface cursor-pointer border-b transition-colors"
                    onClick={() => navigate(ROUTES.incidentDetail(incident.id))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        navigate(ROUTES.incidentDetail(incident.id))
                      }
                    }}
                    tabIndex={0}
                  >
                    <td className="text-text-disabled hidden px-4 py-2.5 tabular-nums sm:table-cell">
                      {incident.id}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="text-text-primary line-clamp-1 min-w-0">{incident.title}</span>
                        {incident.recurrence_of && (
                          <span className="bg-warning/15 text-warning shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-xs">
                            재발
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-text-secondary whitespace-nowrap px-4 py-2.5">
                      {incident.system_display_name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span
                        className={cn(
                          'font-medium uppercase',
                          SEVERITY_STYLES[incident.severity] ?? 'text-text-secondary',
                        )}
                      >
                        {incident.severity}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={incident.status} />
                    </td>
                    <td className="text-text-secondary hidden px-4 py-2.5 tabular-nums md:table-cell">
                      {incident.alert_count}
                    </td>
                    <td className="hidden px-4 py-2.5 md:table-cell">
                      <MttrBadge minutes={incident.mttr_minutes} />
                    </td>
                    <td className="text-text-secondary whitespace-nowrap px-4 py-2.5">
                      {formatRelative(incident.detected_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </NeuCard>
      )}
    </div>
  )
}
