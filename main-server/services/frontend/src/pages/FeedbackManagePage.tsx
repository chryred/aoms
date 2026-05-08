import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, ArrowRight, ClipboardCheck } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { incidentsApi } from '@/api/incidents'
import { useSystems } from '@/hooks/queries/useSystems'
import { useAuthStore } from '@/store/authStore'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { FeedbackPendingList } from '@/components/admin/FeedbackPendingList'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/constants/routes'
import type { IncidentPostmortemItem } from '@/api/incidents'

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-critical/15 text-critical border-critical/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
}

function SeverityBadge({ severity }: { severity?: string }) {
  if (!severity) return null
  const LABELS: Record<string, string> = { critical: 'CRITICAL', warning: 'WARNING' }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        SEVERITY_STYLES[severity] ?? 'bg-surface text-text-secondary border-border',
      )}
    >
      {LABELS[severity] ?? severity.toUpperCase()}
    </span>
  )
}

function PostmortemCard({ item }: { item: IncidentPostmortemItem }) {
  const navigate = useNavigate()
  const p = item.payload
  const incidentId = p.incident_id

  return (
    <NeuCard className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start gap-2">
        {incidentId && <span className="text-text-disabled font-mono text-xs">#{incidentId}</span>}
        {p.severity && <SeverityBadge severity={p.severity} />}
        {p.system_name && <span className="text-text-secondary text-xs">{p.system_name}</span>}
        <span className="text-text-disabled ml-auto font-mono text-xs">
          {item.score.toFixed(4)} RRF
        </span>
      </div>

      {p.title && <p className="text-text-primary leading-snug font-semibold">{p.title}</p>}

      {p.root_cause && (
        <div>
          <p className="text-text-disabled mb-0.5 text-xs font-medium tracking-wider uppercase">
            원인
          </p>
          <p className="text-text-secondary line-clamp-2 text-sm">{p.root_cause}</p>
        </div>
      )}

      {p.solution && (
        <div>
          <p className="text-text-disabled mb-0.5 text-xs font-medium tracking-wider uppercase">
            해결
          </p>
          <p className="text-text-secondary line-clamp-3 text-sm">{p.solution}</p>
        </div>
      )}

      <div className="border-border flex items-center border-t pt-2">
        {p.tags && p.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {p.tags.slice(0, 3).map((tag) => (
              <NeuBadge key={tag} variant="muted" className="text-xs">
                {tag}
              </NeuBadge>
            ))}
          </div>
        )}
        {incidentId && (
          <NeuButton
            variant="ghost"
            size="sm"
            onClick={() => navigate(ROUTES.incidentDetail(incidentId))}
            className="ml-auto gap-1 px-2 text-xs"
          >
            상세 보기
            <ArrowRight className="h-3 w-3" />
          </NeuButton>
        )}
      </div>
    </NeuCard>
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

  const tabs = useMemo(
    () => (isAdmin ? ALL_MANAGE_TABS : ALL_MANAGE_TABS.slice(0, 1)),
    [isAdmin],
  )

  const tabParam = searchParams.get('tab') as ManageTab | null
  const activeTab: ManageTab = tabs.some((t) => t.key === tabParam) ? tabParam! : 'search'

  // 슬라이딩 탭 인디케이터
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

  // 검색 상태
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

  const enabled = appliedQuery.trim().length > 0

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['incidents', 'postmortem-search', appliedQuery, appliedSystemId, appliedSeverity],
    queryFn: () =>
      incidentsApi.searchPostmortem({
        query: appliedQuery.trim(),
        system_id: appliedSystemId ? Number(appliedSystemId) : undefined,
        severity: appliedSeverity || undefined,
        limit: 20,
      }),
    enabled,
    staleTime: 30_000,
  })

  const applySearch = () => {
    const trimmed = query.trim()
    setAppliedQuery(trimmed)
    setAppliedSystemId(systemId)
    setAppliedSeverity(severity)
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
    setSearchParams(
      (prev) => {
        const tab = prev.get('tab') ?? 'search'
        return new URLSearchParams({ tab })
      },
      { replace: true },
    )
  }

  const results = data?.results ?? []
  const hasFilters = appliedQuery || appliedSystemId || appliedSeverity

  return (
    <div>
      <PageHeader
        title="해결책 관리"
        description="인시던트 사후분석 검색 및 해결책 감리를 관리합니다"
      />

      {/* 탭 내비게이션 */}
      <div className="relative mb-4 w-fit max-w-full">
        <div
          role="tablist"
          aria-label="해결책 관리 탭"
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
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-8"
          style={{ background: 'linear-gradient(to left, var(--color-bg-base), transparent)' }}
        />
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
                  <option value="critical">CRITICAL</option>
                  <option value="warning">WARNING</option>
                </NeuSelect>
              </div>
              <NeuButton onClick={applySearch} disabled={!query.trim()}>
                검색
              </NeuButton>
              {hasFilters && (
                <NeuButton variant="ghost" onClick={resetSearch}>
                  초기화
                </NeuButton>
              )}
            </div>

            {/* 결과 */}
            {!enabled ? (
              <EmptyState
                icon={<Search className="h-8 w-8" />}
                title="검색어를 입력하세요"
                description="증상, 원인, 해결책 관련 키워드를 자연어로 입력하고 검색 버튼을 누르세요"
              />
            ) : isLoading ? (
              <LoadingSkeleton shape="card" count={5} />
            ) : isError ? (
              <ErrorCard onRetry={refetch} />
            ) : results.length === 0 ? (
              <EmptyState
                icon={<Search className="h-8 w-8" />}
                title="검색 결과가 없습니다"
                description="다른 키워드로 검색해 보세요"
              />
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-text-secondary text-sm">{results.length}건 검색됨</p>
                {results.map((item) => (
                  <PostmortemCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </>
        )}
        {activeTab === 'audit' && isAdmin && <FeedbackPendingList />}
      </div>
    </div>
  )
}
