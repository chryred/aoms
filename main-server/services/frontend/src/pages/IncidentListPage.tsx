import { useCallback, useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronUp, ChevronDown, Plus, RefreshCw } from 'lucide-react'
import { useIncidents } from '@/hooks/queries/useIncidents'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { IncidentCreateModal } from '@/components/incident/IncidentCreateModal'
import { IncidentSidePanel } from '@/components/incident/IncidentSidePanel'
import { formatRelative, cn } from '@/lib/utils'
import { ROUTES } from '@/constants/routes'
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
  { key: 'investigating', label: '원인파악 중' },
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
    investigating: '원인파악 중',
    resolved: '해결됨',
    closed: '종료',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
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
  return <span className="text-text-secondary whitespace-nowrap tabular-nums">{label}</span>
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col)
    return <ChevronUp className="text-text-disabled ml-1 inline h-3 w-3 opacity-30" />
  return sortDir === 'asc' ? (
    <ChevronUp className="text-accent ml-1 inline h-3 w-3" />
  ) : (
    <ChevronDown className="text-accent ml-1 inline h-3 w-3" />
  )
}

export function IncidentListPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('detected_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedIncident, setSelectedIncident] = useState<IncidentOut | null>(null)

  const {
    data: incidents = [],
    isLoading,
    isError,
    refetch,
  } = useIncidents(statusFilter !== 'all' ? { status: statusFilter, limit: 100 } : { limit: 100 })

  // useRef로 selectedIncident를 추적 — incidents 갱신 시 패널 데이터 즉시 동기화 (eslint-disable 없이)
  const selectedIncidentRef = useRef(selectedIncident)
  useEffect(() => {
    selectedIncidentRef.current = selectedIncident
  })
  useEffect(() => {
    const current = selectedIncidentRef.current
    if (!current) return
    const updated = incidents.find((i) => i.id === current.id)
    if (updated) setSelectedIncident(updated)
  }, [incidents])

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const tablistRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })
  const [tabsOverflow, setTabsOverflow] = useState(false)

  // 탭 오버플로 감지 — 실제 스크롤이 필요할 때만 페이드 그라디언트 표시
  useEffect(() => {
    const el = tablistRef.current
    if (!el) return
    const check = () => setTabsOverflow(el.scrollWidth > el.clientWidth)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const idx = STATUS_TABS.findIndex((t) => t.key === statusFilter)
    const btn = tabRefs.current[idx]
    if (!btn) return
    const { offsetLeft: left, offsetWidth: width } = btn
    setIndicator((prev) => ({ left, width, ready: prev.ready }))
    if (!indicator.ready) {
      requestAnimationFrame(() => setIndicator({ left, width, ready: true }))
    }
  }, [statusFilter, indicator.ready])

  const [isRefreshing, setIsRefreshing] = useState(false)
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await refetch()
    } finally {
      setIsRefreshing(false)
    }
  }, [refetch])

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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="인시던트 관리"
        description="알림·로그 분석을 사건 단위로 추적하고 MTTR을 측정합니다"
        action={
          <div className="flex items-center gap-3">
            {openCount > 0 && (
              <span className="bg-critical/10 text-critical inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                미해결 {openCount}건
              </span>
            )}
            <div className="flex items-center gap-2">
              <NeuButton variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
                새로고침
              </NeuButton>
              <NeuButton size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                인시던트 등록
              </NeuButton>
            </div>
          </div>
        }
      />

      {/* 상태 탭 — 오버플로 페이드 인디케이터 포함 */}
      <div className="relative w-fit max-w-full">
        <div
          role="tablist"
          ref={tablistRef}
          aria-label="인시던트 상태 필터"
          className="bg-bg-base shadow-neu-pressed relative flex gap-1 overflow-x-auto rounded-sm p-1"
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
          {STATUS_TABS.map((tab, i) => (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              role="tab"
              aria-selected={statusFilter === tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                'relative z-10 rounded-sm px-4 py-2.5 text-sm font-medium',
                'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:outline-none',
                'transition-colors duration-150',
                statusFilter === tab.key
                  ? 'text-accent-contrast font-semibold'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {/* 실제 오버플로 시에만 우측 페이드 그라디언트 표시 */}
        {tabsOverflow && (
          <div
            aria-hidden="true"
            className="from-bg-base/80 pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-sm bg-gradient-to-l to-transparent"
          />
        )}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="-mt-2 flex flex-col gap-2">
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
              <table className="w-full text-sm" aria-label="인시던트 목록">
                <thead>
                  <tr className="border-border text-text-secondary border-b">
                    <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">#</th>
                    <th className="px-4 py-2.5 text-left font-medium">제목</th>
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">시스템</th>
                    <th
                      className="hover:text-text-primary cursor-pointer px-4 py-2.5 text-left font-medium whitespace-nowrap select-none"
                      onClick={() => handleSort('severity')}
                    >
                      심각도
                      <SortIcon col="severity" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th
                      className="hover:text-text-primary cursor-pointer px-4 py-2.5 text-left font-medium select-none"
                      onClick={() => handleSort('status')}
                    >
                      상태
                      <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="hidden px-4 py-2.5 text-left font-medium whitespace-nowrap md:table-cell">
                      알림 수
                    </th>
                    <th
                      className="hidden px-4 py-2.5 text-left font-medium md:table-cell"
                      title="Mean Time To Resolve — 감지부터 해결 완료까지 소요 시간"
                    >
                      MTTR
                    </th>
                    <th
                      className="hover:text-text-primary cursor-pointer px-4 py-2.5 text-left font-medium whitespace-nowrap select-none"
                      onClick={() => handleSort('detected_at')}
                    >
                      감지
                      <SortIcon col="detected_at" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="px-2 py-2.5">
                      <span className="sr-only">빠른 편집</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedIncidents.map((incident: IncidentOut) => (
                    <tr
                      key={incident.id}
                      aria-label={`인시던트 #${incident.id} ${incident.title} — 클릭하여 상세 보기`}
                      className="border-border/50 hover:bg-surface group cursor-pointer border-b transition-colors"
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
                          <span className="text-text-primary group-hover:text-accent line-clamp-1 min-w-0 transition-colors">
                            {incident.title}
                          </span>
                          {incident.recurrence_of && (
                            <span className="bg-warning/15 text-warning shrink-0 rounded-full px-1.5 py-0.5 text-xs whitespace-nowrap">
                              재발
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-text-secondary px-4 py-2.5 whitespace-nowrap">
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
                      <td className="text-text-secondary px-4 py-2.5 whitespace-nowrap">
                        {formatRelative(incident.detected_at)}
                      </td>
                      <td className="px-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setSelectedIncident(incident)}
                          aria-label={`인시던트 #${incident.id} 빠른 편집`}
                          className="text-text-disabled hover:text-accent hover:bg-accent/10 focus:ring-accent flex h-11 w-11 items-center justify-center rounded-full transition-colors focus:ring-1 focus:outline-none"
                        >
                          <span className="block h-2 w-2 rounded-full bg-current" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </NeuCard>
        )}
      </div>

      <IncidentCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <IncidentSidePanel incident={selectedIncident} onClose={() => setSelectedIncident(null)} />
    </div>
  )
}
