import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search,
  ArrowRight,
  ClipboardCheck,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { incidentsApi } from '@/api/incidents'
import { useSystems } from '@/hooks/queries/useSystems'
import { useAuthStore } from '@/store/authStore'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { FeedbackPendingList } from '@/components/admin/FeedbackPendingList'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/constants/routes'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import type { IncidentPostmortemItem } from '@/api/incidents'

const SEVERITY_ORDER: Record<string, number> = { critical: 3, warning: 2, info: 1 }

type SortKey = 'incident' | 'severity' | 'score'
type SortDir = 'asc' | 'desc'

function SortableHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  className,
}: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  currentDir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = currentKey === sortKey
  return (
    <th
      scope="col"
      onClick={() => onSort(sortKey)}
      className={cn(
        'text-text-primary cursor-pointer px-4 py-3 text-left text-xs font-semibold tracking-wider whitespace-nowrap uppercase select-none',
        className,
      )}
    >
      <span className="flex items-center gap-1">
        {label}
        {active ? (
          currentDir === 'asc' ? (
            <ChevronUp className="text-accent h-3 w-3" />
          ) : (
            <ChevronDown className="text-accent h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="text-text-disabled h-3 w-3" />
        )}
      </span>
    </th>
  )
}

function PostmortemTable({
  results,
  isListMode,
  sortKey,
  sortDir,
  onSort,
  systemMap,
  systemCodeMap,
}: {
  results: IncidentPostmortemItem[]
  isListMode: boolean
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  systemMap: Record<number, string>
  systemCodeMap: Record<string, string>
}) {
  const navigate = useNavigate()

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border border-b">
            <SortableHeader
              label="#"
              sortKey="incident"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <th
              scope="col"
              className="text-text-primary px-4 py-3 text-left text-xs font-semibold tracking-wider whitespace-nowrap uppercase"
            >
              시스템
            </th>
            <SortableHeader
              label="심각도"
              sortKey="severity"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <th
              scope="col"
              className="text-text-primary px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase"
            >
              제목
            </th>
            <th
              scope="col"
              className="text-text-primary hidden px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase md:table-cell"
            >
              원인
            </th>
            <th
              scope="col"
              className="text-text-primary hidden px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase lg:table-cell"
            >
              해결
            </th>
            {!isListMode && (
              <SortableHeader
                label="유사도"
                sortKey="score"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={onSort}
                className="text-right"
              />
            )}
            <th scope="col" className="w-8 px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {results.map((item) => {
            const p = item.payload
            const incidentId = p.incident_id
            const displayName =
              (p.system_id != null && systemMap[p.system_id]) ||
              (p.system_name && systemCodeMap[p.system_name]) ||
              p.system_name ||
              '—'
            return (
              <tr
                key={item.id}
                onClick={() => incidentId && navigate(ROUTES.incidentDetail(incidentId))}
                className={cn(
                  'transition-colors',
                  incidentId ? 'hover:bg-accent-04 cursor-pointer' : 'cursor-default',
                )}
              >
                <td className="text-text-secondary px-4 py-3 font-mono text-xs whitespace-nowrap">
                  {incidentId ? `#${incidentId}` : '—'}
                </td>
                <td className="text-text-primary px-4 py-3 text-sm whitespace-nowrap">
                  {displayName}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {p.severity ? (
                    <SeverityBadge severity={p.severity} />
                  ) : (
                    <span className="text-text-disabled text-xs">—</span>
                  )}
                </td>
                <td className="text-text-primary max-w-[240px] px-4 py-3 font-medium">
                  <span className="line-clamp-1">{p.title ?? '—'}</span>
                </td>
                <td className="text-text-secondary hidden max-w-[200px] px-4 py-3 text-xs md:table-cell">
                  <span className="line-clamp-2">{p.root_cause ?? '—'}</span>
                </td>
                <td className="text-text-secondary hidden max-w-[200px] px-4 py-3 text-xs lg:table-cell">
                  <span className="line-clamp-2">{p.solution ?? '—'}</span>
                </td>
                {!isListMode && (
                  <td className="text-text-disabled px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                    {item.score > 0 ? item.score.toFixed(4) : '—'}
                  </td>
                )}
                <td className="px-4 py-3">
                  {incidentId && <ArrowRight className="text-text-disabled h-3.5 w-3.5" />}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type ManageTab = 'search' | 'audit'

const ALL_MANAGE_TABS: Array<{ key: ManageTab; label: string; icon: React.ReactNode }> = [
  { key: 'search', label: '해결책 검색', icon: <Search className="h-4 w-4" /> },
  { key: 'audit', label: '해결책 감리', icon: <ClipboardCheck className="h-4 w-4" /> },
]

export function FeedbackManagePage() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const [searchParams, setSearchParams] = useSearchParams()

  const tabs = useMemo(() => (isAdmin ? ALL_MANAGE_TABS : ALL_MANAGE_TABS.slice(0, 1)), [isAdmin])

  const tabParam = searchParams.get('tab') as ManageTab | null
  const activeTab: ManageTab = tabs.some((t) => t.key === tabParam) ? tabParam! : 'search'

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  useEffect(() => {
    const idx = tabs.findIndex((t) => t.key === activeTab)
    const btn = tabRefs.current[idx]
    if (!btn) return
    const { offsetLeft: left, offsetWidth: width } = btn
    setIndicator((prev) => ({ left, width, ready: prev.ready }))
    if (!indicator.ready) {
      requestAnimationFrame(() => setIndicator({ left, width, ready: true }))
    }
  }, [activeTab, indicator.ready, tabs])

  const setTab = (tab: ManageTab) => {
    const params = new URLSearchParams(searchParams)
    params.set('tab', tab)
    setSearchParams(params, { replace: true })
  }

  const initialSystemId = searchParams.get('system_id') ?? ''
  const initialQuery = searchParams.get('q') ?? ''
  const initialSeverity = searchParams.get('severity') ?? ''

  const [systemId, setSystemId] = useState<string>(initialSystemId)
  const [severity, setSeverity] = useState<string>(initialSeverity)
  const [query, setQuery] = useState(initialQuery)
  const [appliedQuery, setAppliedQuery] = useState(initialQuery)
  const [appliedSystemId, setAppliedSystemId] = useState(initialSystemId)
  const [appliedSeverity, setAppliedSeverity] = useState(initialSeverity)

  const { data: systems = [] } = useSystems()
  const systemMap = useMemo(
    () =>
      systems.reduce<Record<number, string>>((acc, s) => {
        acc[s.id] = s.display_name
        return acc
      }, {}),
    [systems],
  )
  const systemCodeMap = useMemo(
    () =>
      systems.reduce<Record<string, string>>((acc, s) => {
        acc[s.system_name] = s.display_name
        return acc
      }, {}),
    [systems],
  )

  const [hasSearched, setHasSearched] = useState(
    initialQuery.length > 0 || initialSystemId.length > 0 || initialSeverity.length > 0,
  )

  const [sortKey, setSortKey] = useState<SortKey>(initialQuery ? 'score' : 'incident')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['incidents', 'postmortem-search', appliedQuery, appliedSystemId, appliedSeverity],
    queryFn: () =>
      incidentsApi.searchPostmortem({
        query: appliedQuery.trim() || undefined,
        system_id: appliedSystemId ? Number(appliedSystemId) : undefined,
        severity: appliedSeverity || undefined,
        limit: 20,
      }),
    enabled: hasSearched,
    staleTime: 30_000,
  })

  const applySearch = () => {
    const trimmed = query.trim()
    setAppliedQuery(trimmed)
    setAppliedSystemId(systemId)
    setAppliedSeverity(severity)
    setHasSearched(true)
    setSortKey(trimmed ? 'score' : 'incident')
    setSortDir('desc')
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (trimmed) next.set('q', trimmed)
        else next.delete('q')
        if (systemId) next.set('system_id', systemId)
        else next.delete('system_id')
        if (severity) next.set('severity', severity)
        else next.delete('severity')
        return next
      },
      { replace: true },
    )
  }

  const onQueryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      applySearch()
    }
  }

  const resetSearch = () => {
    setQuery('')
    setAppliedQuery('')
    setSystemId('')
    setAppliedSystemId('')
    setSeverity('')
    setAppliedSeverity('')
    setHasSearched(false)
    setSortKey('score')
    setSortDir('desc')
    setSearchParams(
      (prev) => {
        const tab = prev.get('tab') ?? 'search'
        return new URLSearchParams({ tab })
      },
      { replace: true },
    )
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const results = useMemo(() => {
    const raw = data?.results ?? []
    if (!raw.length) return raw
    const mul = sortDir === 'asc' ? 1 : -1
    return [...raw].sort((a, b) => {
      if (sortKey === 'incident') {
        return mul * ((a.payload.incident_id ?? 0) - (b.payload.incident_id ?? 0))
      }
      if (sortKey === 'severity') {
        const aVal = SEVERITY_ORDER[a.payload.severity ?? ''] ?? 0
        const bVal = SEVERITY_ORDER[b.payload.severity ?? ''] ?? 0
        return mul * (aVal - bVal)
      }
      // score
      return mul * (a.score - b.score)
    })
  }, [data, sortKey, sortDir])

  const hasFilters = appliedQuery || appliedSystemId || appliedSeverity
  const isListMode = hasSearched && !appliedQuery.trim()

  return (
    <div>
      <PageHeader
        title="해결책 검색"
        description="과거 인시던트 사후분석을 시맨틱 검색하거나 전체 목록을 조회합니다"
      />

      {/* 탭 내비게이션 */}
      <div className="relative mb-4 w-fit max-w-full">
        <div
          role="tablist"
          aria-label="해결책 검색 탭"
          className="bg-bg-base shadow-neu-pressed relative flex w-fit max-w-full gap-1 overflow-x-auto rounded-sm p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
          {tabs.map((tab, i) => (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`tabpanel-${tab.key}`}
              id={`tab-${tab.key}`}
              type="button"
              onClick={() => setTab(tab.key)}
              className={cn(
                'relative z-10 flex items-center gap-2 rounded-sm px-4 py-3 text-sm font-medium whitespace-nowrap',
                'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:outline-none',
                'transition-colors duration-150',
                activeTab === tab.key
                  ? 'text-accent-contrast font-semibold'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <span aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 콘텐츠 */}
      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'search' && (
          <>
            {/* 검색 폼 */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="min-w-[280px] flex-1">
                <NeuInput
                  placeholder="증상·원인·해결책 자연어 검색"
                  leftIcon={<Search className="h-4 w-4" />}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onQueryKeyDown}
                />
              </div>
              <div className="w-48">
                <NeuSelect value={systemId} onChange={(e) => setSystemId(e.target.value)}>
                  <option value="">전체 시스템</option>
                  {systems.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.display_name}
                    </option>
                  ))}
                </NeuSelect>
              </div>
              <div className="w-36">
                <NeuSelect value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  <option value="">전체 심각도</option>
                  <option value="critical">위험</option>
                  <option value="warning">경고</option>
                </NeuSelect>
              </div>
              <NeuButton onClick={applySearch}>검색</NeuButton>
              {(hasFilters || hasSearched) && (
                <NeuButton variant="ghost" onClick={resetSearch}>
                  초기화
                </NeuButton>
              )}
            </div>

            {/* 결과 */}
            {!hasSearched ? (
              <EmptyState
                icon={<Search className="h-8 w-8" />}
                title="검색어 또는 필터를 선택하고 검색하세요"
                description="키워드 없이 검색하면 전체 목록이 표시됩니다. 시스템·심각도 필터를 조합할 수 있습니다."
              />
            ) : isLoading ? (
              <LoadingSkeleton shape="card" count={5} />
            ) : isError ? (
              <ErrorCard onRetry={refetch} />
            ) : results.length === 0 ? (
              <EmptyState
                icon={<Search className="h-8 w-8" />}
                title={isListMode ? '등록된 사후분석이 없습니다' : '검색 결과가 없습니다'}
                description={isListMode ? '필터를 변경해 보세요' : '다른 키워드로 검색해 보세요'}
              />
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-text-secondary text-sm">
                  {isListMode ? `전체 ${results.length}건` : `${results.length}건 검색됨`}
                </p>
                <PostmortemTable
                  results={results}
                  isListMode={isListMode}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  systemMap={systemMap}
                  systemCodeMap={systemCodeMap}
                />
              </div>
            )}
          </>
        )}
        {activeTab === 'audit' && isAdmin && <FeedbackPendingList />}
      </div>
    </div>
  )
}
