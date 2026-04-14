import { useEffect } from 'react'
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

function CollectionInfoBar() {
  const { data, isLoading } = useCollectionInfo()

  if (isLoading)
    return <div className="text-text-secondary mb-4 text-sm">컬렉션 정보 로딩 중...</div>
  if (!data || !data.metric_hourly_patterns || !data.aggregation_summaries) return null

  const statusColor = (s: string) => {
    if (s === 'green') return 'text-normal'
    if (s === 'yellow') return 'text-warning'
    if (s === 'red' || s === 'error') return 'text-critical'
    return 'text-text-secondary'
  }

  return (
    <div className="text-text-secondary mb-4 flex flex-wrap gap-4 text-sm">
      <span>
        시간별 패턴:{' '}
        <span className={statusColor(data.metric_hourly_patterns.status)}>
          {(data.metric_hourly_patterns.points_count ?? 0).toLocaleString()}건
        </span>
      </span>
      <span>
        기간별 요약:{' '}
        <span className={statusColor(data.aggregation_summaries.status)}>
          {(data.aggregation_summaries.points_count ?? 0).toLocaleString()}건
        </span>
      </span>
    </div>
  )
}

export default function SimilarSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const threshold = Number(searchParams.get('threshold') ?? '0.5')
  const collection = searchParams.get('collection') ?? 'metric_hourly_patterns'

  const { mutate, data, isPending, isError, reset } = useSimilarSearch()

  // URL 파라미터가 있으면 자동 검색
  useEffect(() => {
    if (!query.trim()) return
    mutate({ query_text: query, collection, score_threshold: threshold, limit: 10 })
  }, [query, threshold, collection]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch(params: { query: string; threshold: number; collection: string }) {
    setSearchParams({
      q: params.query,
      threshold: String(params.threshold),
      collection: params.collection,
    })
  }

  return (
    <div>
      <PageHeader
        title="유사 장애 검색"
        description="자연어로 유사한 과거 장애 패턴을 검색합니다"
      />

      <CollectionInfoBar />

      <SimilarSearchInput
        defaultQuery={query}
        defaultThreshold={threshold}
        defaultCollection={collection}
        onSearch={handleSearch}
        isPending={isPending}
      />

      <div className="mt-6">
        {isPending && <LoadingSkeleton shape="card" count={3} />}

        {isError && (
          <ErrorCard
            onRetry={() => {
              reset()
              mutate({ query_text: query, collection, score_threshold: threshold, limit: 10 })
            }}
          />
        )}

        {!isPending && !isError && !data && (
          <EmptyState
            icon={<Search className="text-text-secondary h-12 w-12" />}
            title="유사 장애를 검색해보세요"
            description="과거 메트릭 패턴이나 집계 요약에서 유사한 상황을 찾아드립니다."
          />
        )}

        {!isPending && !isError && data && data.count === 0 && (
          <EmptyState
            icon={<SearchX className="text-text-secondary h-12 w-12" />}
            title="유사한 장애 패턴을 찾지 못했습니다"
            description={`유사도 기준값(${(threshold * 100).toFixed(0)}%)을 낮추거나 검색어를 변경해보세요.`}
          />
        )}

        {!isPending && !isError && data && data.count > 0 && (
          <div className="flex flex-col gap-4">
            {data.results.map((result) => (
              <SimilarResultCard key={result.id} result={result} collection={collection} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
