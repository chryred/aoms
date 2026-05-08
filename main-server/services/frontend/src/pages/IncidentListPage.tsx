import { useCallback, useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Pencil,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { useIncidents } from '@/hooks/queries/useIncidents'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import { incidentsApi } from '@/api/incidents'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { IncidentCreateModal } from '@/components/incident/IncidentCreateModal'
import { IncidentSidePanel } from '@/components/incident/IncidentSidePanel'
import { formatRelative, cn } from '@/lib/utils'
import { ROUTES } from '@/constants/routes'
import { INCIDENT_STATUS_LABELS, INCIDENT_STATUS_STYLES } from '@/constants/incident'
import type { IncidentOut } from '@/api/incidents'

type StatusFilter = 'all' | 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'closed'
type FeedbackStatusFilter = 'all' | 'registrable' | 'completed'
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

// 해결책 상태 배지 — latest feedback status 기준 (상세 페이지와 일관성)
// latest_feedback_status: 가장 최근 피드백의 status (백엔드 제공)
// 우선순위: latest_feedback_status > has_approved_feedback > 인시던트 status
const FEEDBACK_STATUS_STYLES: Record<string, string> = {
  registrable: 'bg-accent/15 text-accent border-accent/30',
  pending: 'bg-warning/15 text-warning border-warning/30',
  approved: 'bg-normal/15 text-normal border-normal/30',
  rejected: 'bg-critical/15 text-critical border-critical/30',
}

function FeedbackStatusBadge({
  incidentStatus,
  latestFeedbackStatus,
}: {
  incidentStatus: string
  latestFeedbackStatus: string | null
}) {
  // 1) 최근 피드백이 있으면 그 status를 표시 (상세 페이지와 동일 로직)
  if (latestFeedbackStatus === 'pending') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
          FEEDBACK_STATUS_STYLES['pending'],
        )}
      >
        승인 대기
      </span>
    )
  }
  if (latestFeedbackStatus === 'approved') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
          FEEDBACK_STATUS_STYLES['approved'],
        )}
      >
        승인 완료
      </span>
    )
  }
  if (latestFeedbackStatus === 'rejected') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
          FEEDBACK_STATUS_STYLES['rejected'],
        )}
      >
        반려
      </span>
    )
  }
  // 2) 피드백 없음 — 인시던트 종료된 경우 "등록 가능"
  const isResolvable = incidentStatus === 'resolved' || incidentStatus === 'closed'
  if (!isResolvable) {
    return <span className="text-text-disabled text-xs">—</span>
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        FEEDBACK_STATUS_STYLES['registrable'],
      )}
    >
      등록 가능
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        INCIDENT_STATUS_STYLES[status] ?? 'bg-surface text-text-secondary border-border',
      )}
    >
      {INCIDENT_STATUS_LABELS[status] ?? status}
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
  if (sortKey !== col) return <ChevronsUpDown className="text-text-disabled ml-1 inline h-3 w-3" />
  return sortDir === 'asc' ? (
    <ChevronUp className="text-accent ml-1 inline h-3 w-3" />
  ) : (
    <ChevronDown className="text-accent ml-1 inline h-3 w-3" />
  )
}

export function IncidentListPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState<FeedbackStatusFilter>('all')
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

  // 통계 3카드 — React Query
  const { data: stats } = useQuery({
    queryKey: ['incidents', 'stats'],
    queryFn: () => incidentsApi.stats(),
    staleTime: 60_000,
  })

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

  // 통계 카드 클릭 핸들러 — feedbackStatusFilter 토글
  const handleStatCardClick = (card: FeedbackStatusFilter) => {
    setFeedbackStatusFilter((prev) => (prev === card ? 'all' : card))
  }

  // 해결책 상태 필터 predicate (latest_feedback_status 기준 — 상세 페이지와 일관)
  const feedbackStatusPredicate = (incident: IncidentOut): boolean => {
    if (feedbackStatusFilter === 'all') return true
    if (feedbackStatusFilter === 'completed') {
      return incident.latest_feedback_status === 'approved'
    }
    if (feedbackStatusFilter === 'registrable') {
      // pending/rejected는 다시 작성/대기 필요 → 등록 가능에 포함
      // 또는 종료된 인시던트인데 피드백 자체 없음
      const isResolvable = incident.status === 'resolved' || incident.status === 'closed'
      const noFeedbackOrNeedsAction =
        !incident.latest_feedback_status ||
        incident.latest_feedback_status === 'rejected' ||
        incident.latest_feedback_status === 'pending'
      return isResolvable && noFeedbackOrNeedsAction
    }
    return true
  }

  const sortedIncidents = useMemo(() => {
    return [...incidents].filter(feedbackStatusPredicate).sort((a, b) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidents, sortKey, sortDir, feedbackStatusFilter])

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

      {/* 통계 3카드 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {/* 전체 분석 건수 */}
        <button
          type="button"
          onClick={() => handleStatCardClick('all')}
          aria-pressed={feedbackStatusFilter === 'all'}
          className="focus:ring-accent rounded-sm text-left focus:ring-1 focus:outline-none"
        >
          <NeuCard
            className={cn(
              'text-center transition-shadow',
              feedbackStatusFilter === 'all'
                ? 'ring-accent/50 ring-1'
                : 'hover:ring-accent/30 hover:ring-1',
            )}
          >
            <p className="text-text-primary text-3xl font-bold tabular-nums">
              {stats?.total ?? incidents.length}
            </p>
            <p className="text-text-secondary mt-1 text-sm">전체 분석 건수</p>
          </NeuCard>
        </button>

        {/* 피드백 제출 가능 */}
        <button
          type="button"
          onClick={() => handleStatCardClick('registrable')}
          aria-pressed={feedbackStatusFilter === 'registrable'}
          className="focus:ring-accent rounded-sm text-left focus:ring-1 focus:outline-none"
        >
          <NeuCard
            className={cn(
              'text-center transition-shadow',
              feedbackStatusFilter === 'registrable'
                ? 'ring-accent ring-1'
                : 'hover:ring-accent/30 hover:ring-1',
            )}
          >
            <p className="text-accent text-3xl font-bold tabular-nums">
              {stats?.registrable ??
                incidents.filter((i) => i.status === 'resolved' || i.status === 'closed').length}
            </p>
            <p className="text-text-secondary mt-1 text-sm">피드백 제출 가능</p>
          </NeuCard>
        </button>

        {/* 확인 처리 완료 */}
        <button
          type="button"
          onClick={() => handleStatCardClick('completed')}
          aria-pressed={feedbackStatusFilter === 'completed'}
          className="focus:ring-accent rounded-sm text-left focus:ring-1 focus:outline-none"
        >
          <NeuCard
            className={cn(
              'text-center transition-shadow',
              feedbackStatusFilter === 'completed'
                ? 'ring-accent ring-1'
                : 'hover:ring-accent/30 hover:ring-1',
            )}
          >
            <p className="text-normal text-3xl font-bold tabular-nums">{stats?.completed ?? 0}</p>
            <p className="text-text-secondary mt-1 text-sm">확인 처리 완료</p>
          </NeuCard>
        </button>
      </div>

      {/* 상태 탭 + 해결책 상태 필터 */}
      <div className="flex flex-wrap items-center gap-3">
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

        {/* 해결책 상태 필터 */}
        <div className="w-40">
          <NeuSelect
            value={feedbackStatusFilter}
            onChange={(e) => setFeedbackStatusFilter(e.target.value as FeedbackStatusFilter)}
          >
            <option value="all">해결책 전체</option>
            <option value="registrable">등록 가능</option>
            <option value="completed">승인 완료</option>
          </NeuSelect>
        </div>
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
                      aria-sort={
                        sortKey === 'severity'
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                      className="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                    >
                      <button
                        type="button"
                        onClick={() => handleSort('severity')}
                        className="hover:text-text-primary focus:ring-accent flex items-center rounded-sm font-medium select-none focus:ring-1 focus:outline-none"
                      >
                        심각도
                        <SortIcon col="severity" sortKey={sortKey} sortDir={sortDir} />
                      </button>
                    </th>
                    <th
                      aria-sort={
                        sortKey === 'status'
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                      className="px-4 py-2.5 text-left font-medium"
                    >
                      <button
                        type="button"
                        onClick={() => handleSort('status')}
                        className="hover:text-text-primary focus:ring-accent flex items-center rounded-sm font-medium select-none focus:ring-1 focus:outline-none"
                      >
                        상태
                        <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
                      </button>
                    </th>
                    <th className="hidden px-4 py-2.5 text-left font-medium whitespace-nowrap md:table-cell">
                      해결책 상태
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
                      aria-sort={
                        sortKey === 'detected_at'
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                      className="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                    >
                      <button
                        type="button"
                        onClick={() => handleSort('detected_at')}
                        className="hover:text-text-primary focus:ring-accent flex items-center rounded-sm font-medium select-none focus:ring-1 focus:outline-none"
                      >
                        감지
                        <SortIcon col="detected_at" sortKey={sortKey} sortDir={sortDir} />
                      </button>
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
                        <SeverityBadge severity={incident.severity} />
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={incident.status} />
                      </td>
                      <td className="hidden px-4 py-2.5 md:table-cell">
                        <FeedbackStatusBadge
                          incidentStatus={incident.status}
                          latestFeedbackStatus={incident.latest_feedback_status}
                        />
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
                          className="text-text-disabled hover:text-accent hover:bg-accent/10 focus:ring-accent group-hover:text-text-secondary flex h-11 w-11 items-center justify-center rounded-sm transition-colors focus:ring-1 focus:outline-none"
                        >
                          <Pencil className="h-4 w-4" />
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
