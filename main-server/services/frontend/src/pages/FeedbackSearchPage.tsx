import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, ArrowRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { incidentsApi } from '@/api/incidents'
import { useSystems } from '@/hooks/queries/useSystems'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { EmptyState } from '@/components/common/EmptyState'
import { ROUTES } from '@/constants/routes'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import type { IncidentPostmortemItem } from '@/api/incidents'

function PostmortemCard({ item }: { item: IncidentPostmortemItem }) {
  const navigate = useNavigate()
  const p = item.payload
  const incidentId = p.incident_id

  return (
    <NeuCard className="flex flex-col gap-3 p-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start gap-2">
        {incidentId && <span className="text-text-disabled font-mono text-xs">#{incidentId}</span>}
        {p.severity && <SeverityBadge severity={p.severity} />}
        {p.system_name && <span className="text-text-secondary text-xs">{p.system_name}</span>}
        <span className="text-text-disabled ml-auto font-mono text-xs">
          {item.score.toFixed(4)} RRF
        </span>
      </div>

      {/* 제목 */}
      {p.title && <p className="text-text-primary leading-snug font-semibold">{p.title}</p>}

      {/* 원인 */}
      {p.root_cause && (
        <div>
          <p className="text-text-disabled mb-0.5 text-xs font-medium tracking-wider uppercase">
            원인
          </p>
          <p className="text-text-secondary line-clamp-2 text-sm">{p.root_cause}</p>
        </div>
      )}

      {/* 해결 */}
      {p.solution && (
        <div>
          <p className="text-text-disabled mb-0.5 text-xs font-medium tracking-wider uppercase">
            해결
          </p>
          <p className="text-text-secondary line-clamp-3 text-sm">{p.solution}</p>
        </div>
      )}

      {/* 푸터 */}
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

export function FeedbackSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()

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
    setSearchParams({}, { replace: true })
  }

  const results = data?.results ?? []
  const hasFilters = appliedQuery || appliedSystemId || appliedSeverity

  return (
    <>
      <div className="mb-3 flex items-baseline gap-3">
        <h1 className="text-text-primary text-base font-bold">해결책 검색</h1>
        <p className="text-text-secondary text-xs">
          과거 인시던트 사후분석(postmortem)을 시맨틱 검색으로 찾습니다
        </p>
      </div>

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
  )
}
