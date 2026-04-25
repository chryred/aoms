import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, SearchX } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { SimilarSearchInput } from '@/components/search/SimilarSearchInput'
import { SimilarResultCard } from '@/components/search/SimilarResultCard'
import { useSimilarSearch } from '@/hooks/mutations/useSimilarSearch'
import { useCollectionInfo } from '@/hooks/queries/useCollectionInfo'
import { useSystems } from '@/hooks/queries/useSystems'
import { cn } from '@/lib/utils'
import type { SimilarSearchResult } from '@/types/search'
import type { HourlyPatternPayload, AggSummaryPayload } from '@/types/search'

type SeverityFilter = 'all' | 'critical' | 'warning' | 'normal'

const SEVERITY_LABELS: Record<SeverityFilter, string> = {
  all: '전체',
  critical: '위험',
  warning: '경고',
  normal: '정상',
}

function getResultSeverity(result: SimilarSearchResult, collection: string): string {
  if (collection === 'metric_hourly_patterns' && 'hour_bucket' in result.payload) {
    return (result.payload as HourlyPatternPayload).llm_severity
  }
  return (result.payload as AggSummaryPayload).dominant_severity
}

export default function SimilarSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const collection = searchParams.get('collection') ?? 'metric_hourly_patterns'

  const { mutate, data, isPending, isError, reset } = useSimilarSearch()
  const { data: collectionInfo } = useCollectionInfo()
  const { data: systems } = useSystems()
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')

  const systemDisplayMap = useMemo(
    () => new Map(systems?.map((s) => [s.system_name, s.display_name]) ?? []),
    [systems],
  )

  const collectionPoints = useMemo(
    () => ({
      metric_hourly_patterns: collectionInfo?.metric_hourly_patterns?.points_count,
      aggregation_summaries: collectionInfo?.aggregation_summaries?.points_count,
    }),
    [collectionInfo],
  )

  // URL 파라미터가 있으면 자동 검색
  useEffect(() => {
    if (!query.trim()) return
    mutate({ query_text: query, collection, limit: 10 })
  }, [query, collection]) // eslint-disable-line react-hooks/exhaustive-deps

  // 컬렉션 변경 시 필터 초기화
  useEffect(() => {
    setSeverityFilter('all')
  }, [collection, query])

  function handleSearch(params: { query: string; collection: string }) {
    setSearchParams({ q: params.query, collection: params.collection })
  }

  const filteredResults = useMemo(() => {
    if (!data?.results) return []
    if (severityFilter === 'all') return data.results
    return data.results.filter((r) => getResultSeverity(r, collection) === severityFilter)
  }, [data, severityFilter, collection])

  const severityCounts = useMemo(() => {
    if (!data?.results) return {} as Record<SeverityFilter, number>
    const counts: Record<string, number> = { all: data.results.length }
    for (const r of data.results) {
      const sev = getResultSeverity(r, collection)
      counts[sev] = (counts[sev] ?? 0) + 1
    }
    return counts as Record<SeverityFilter, number>
  }, [data, collection])

  const hasMultipleSeverities =
    data?.results && new Set(data.results.map((r) => getResultSeverity(r, collection))).size > 1

  return (
    <div>
      <PageHeader
        title="유사 장애 검색"
        description="자연어로 유사한 과거 장애 패턴을 검색합니다"
      />

      <SimilarSearchInput
        defaultQuery={query}
        defaultCollection={collection}
        onSearch={handleSearch}
        isPending={isPending}
        collectionPoints={collectionPoints}
      />

      <div className="mt-8">
        {/* 스크린 리더용 검색 결과 공지 */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {!isPending && data && data.count > 0 && `${data.count}건의 유사 장애 패턴을 찾았습니다.`}
          {!isPending && data && data.count === 0 && '유사한 장애 패턴을 찾지 못했습니다.'}
          {!isPending && isError && '검색 중 오류가 발생했습니다.'}
        </div>

        {isPending && <LoadingSkeleton shape="card" count={3} />}

        {isError && (
          <ErrorCard
            onRetry={() => {
              reset()
              mutate({ query_text: query, collection, limit: 10 })
            }}
          />
        )}

        {!isPending && !isError && !data && (
          <EmptyState
            icon={<Search aria-hidden="true" className="text-text-secondary h-12 w-12" />}
            title="유사 장애를 검색해보세요"
            description="과거 메트릭 패턴이나 집계 요약에서 유사한 상황을 찾아드립니다."
          />
        )}

        {!isPending && !isError && data && data.count === 0 && (
          <EmptyState
            icon={<SearchX aria-hidden="true" className="text-text-secondary h-12 w-12" />}
            title="유사한 장애 패턴을 찾지 못했습니다"
            description="검색어를 변경하거나 다른 컬렉션에서 검색해보세요."
          />
        )}

        {!isPending && !isError && data && data.count > 0 && (
          <>
            {/* 심각도 필터 — 복수 심각도 결과일 때만 표시 */}
            {hasMultipleSeverities && (
              <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="심각도 필터">
                {(['all', 'critical', 'warning', 'normal'] as SeverityFilter[])
                  .filter((s) => s === 'all' || (severityCounts[s] ?? 0) > 0)
                  .map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeverityFilter(s)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-sm px-3 py-1 text-xs font-medium transition-all',
                        'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:ring-offset-2 focus:outline-none',
                        s === 'all' &&
                          severityFilter === s &&
                          'bg-accent text-accent-contrast shadow-neu-flat',
                        s === 'all' &&
                          severityFilter !== s &&
                          'bg-bg-base text-text-secondary shadow-neu-flat hover:text-text-primary',
                        s === 'critical' &&
                          severityFilter === s &&
                          'bg-critical-bg text-critical-text shadow-neu-flat',
                        s === 'critical' &&
                          severityFilter !== s &&
                          'bg-bg-base text-text-secondary shadow-neu-flat hover:text-critical-text',
                        s === 'warning' &&
                          severityFilter === s &&
                          'bg-warning-bg text-warning-text shadow-neu-flat',
                        s === 'warning' &&
                          severityFilter !== s &&
                          'bg-bg-base text-text-secondary shadow-neu-flat hover:text-warning-text',
                        s === 'normal' &&
                          severityFilter === s &&
                          'bg-normal-bg text-normal-text shadow-neu-flat',
                        s === 'normal' &&
                          severityFilter !== s &&
                          'bg-bg-base text-text-secondary shadow-neu-flat hover:text-normal-text',
                      )}
                    >
                      {SEVERITY_LABELS[s]}
                      <span className="tabular-nums opacity-70">
                        {s === 'all' ? data.count : (severityCounts[s] ?? 0)}
                      </span>
                    </button>
                  ))}
              </div>
            )}

            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" role="list">
              {filteredResults.map((result) => (
                <li key={result.id}>
                  <SimilarResultCard
                    result={result}
                    collection={collection}
                    systemDisplayName={systemDisplayMap.get(result.payload.system_name)}
                  />
                </li>
              ))}
            </ul>

            {filteredResults.length === 0 && severityFilter !== 'all' && (
              <p className="text-text-secondary text-sm">
                선택한 심각도의 결과가 없습니다.{' '}
                <button
                  type="button"
                  onClick={() => setSeverityFilter('all')}
                  className="text-accent hover:underline focus:outline-none"
                >
                  전체 보기
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
