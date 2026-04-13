import { RefreshCw } from 'lucide-react'
import { useCollectionInfo } from '@/hooks/queries/useCollectionInfo'
import { useAggregationStatus } from '@/hooks/queries/useAggregationStatus'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { formatRelative } from '@/lib/utils'
import type { AggregationPipelineKey } from '@/types/search'

// 컬렉션 status → 색상 + 레이블 매핑
const COLLECTION_STATUS_MAP: Record<string, { color: string; label: string }> = {
  green: { color: '#22C55E', label: '정상' },
  yellow: { color: '#F59E0B', label: '주의' },
  red: { color: '#EF4444', label: '오류' },
  error: { color: '#EF4444', label: '오류' },
  not_found: { color: '#5A6478', label: '미생성' },
}

// 파이프라인 레이블 (log-analyzer 내부 스케줄러 기준)
const PIPELINE_META: Record<AggregationPipelineKey, { tag: string; label: string }> = {
  hourly: { tag: '1시간', label: '시간별 집계' },
  daily: { tag: '매일', label: '일별 집계' },
  weekly: { tag: '매주', label: '주간 리포트' },
  monthly: { tag: '매월', label: '월간 리포트' },
  longperiod: { tag: '분기+', label: '장기 리포트' },
  trend: { tag: '4시간', label: '장애 예측' },
}

const PIPELINE_ORDER: AggregationPipelineKey[] = [
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'longperiod',
  'trend',
]

function StatusDot({ status }: { status: string }) {
  const { color } = COLLECTION_STATUS_MAP[status] ?? { color: '#5A6478' }
  return (
    <span
      className="inline-block h-3 w-3 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  )
}

export function VectorHealthPage() {
  const {
    data: collectionInfo,
    isLoading: collectionLoading,
    error: collectionError,
    refetch: refetchCollection,
  } = useCollectionInfo()

  const {
    data: aggStatus,
    isLoading: aggLoading,
    error: aggError,
    refetch: refetchAgg,
  } = useAggregationStatus()

  const handleRefresh = () => {
    refetchCollection()
    refetchAgg()
  }

  const isLoading = collectionLoading || aggLoading
  const hasError = collectionError || aggError

  return (
    <div>
      <PageHeader
        title="벡터 컬렉션 상태"
        description="Qdrant 컬렉션 및 집계 파이프라인 실행 현황"
        action={
          <div className="flex items-center gap-2">
            <NeuBadge variant="muted">관리자 전용</NeuBadge>
            <NeuButton variant="ghost" size="sm" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={`mr-1 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              새로고침
            </NeuButton>
          </div>
        }
      />

      {isLoading ? (
        <LoadingSkeleton shape="card" count={4} />
      ) : hasError ? (
        <ErrorCard onRetry={handleRefresh} />
      ) : (
        <>
          {/* 컬렉션 상태 카드 */}
          <h2 className="type-label mb-3">컬렉션 현황</h2>
          <div className="mb-6 grid grid-cols-2 gap-4">
            {collectionInfo && (
              <>
                {(
                  [
                    {
                      key: 'log_incidents',
                      label: 'log_incidents',
                      desc: '로그 분석 이상 이력',
                    },
                    {
                      key: 'metric_baselines',
                      label: 'metric_baselines',
                      desc: '메트릭 알림 이상 이력',
                    },
                    {
                      key: 'metric_hourly_patterns',
                      label: 'metric_hourly_patterns',
                      desc: '시간별 집계 패턴',
                    },
                    {
                      key: 'aggregation_summaries',
                      label: 'aggregation_summaries',
                      desc: '집계 요약',
                    },
                  ] as const
                ).map(({ key, label, desc }) => {
                  const info = collectionInfo[key] ?? {
                    points_count: 0,
                    vectors_count: 0,
                    status: 'not_found',
                  }
                  const statusMeta = COLLECTION_STATUS_MAP[info.status] ?? {
                    color: '#5A6478',
                    label: info.status,
                  }
                  return (
                    <NeuCard key={key}>
                      <div className="mb-3 flex items-start justify-between">
                        <div>
                          <p className="text-text-secondary mb-0.5 font-mono text-xs">{label}</p>
                          <p className="text-text-disabled text-xs">{desc}</p>
                        </div>
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            color: statusMeta.color,
                            backgroundColor: `${statusMeta.color}18`,
                          }}
                        >
                          {statusMeta.label}
                        </span>
                      </div>
                      {info.status === 'error' ? (
                        <p className="text-critical text-xs">{info.detail ?? '연결 오류'}</p>
                      ) : (
                        <div className="flex gap-6">
                          <div>
                            <p className="text-text-primary text-2xl font-bold">
                              {(info.points_count ?? 0).toLocaleString()}
                            </p>
                            <p className="text-text-secondary text-xs">포인트 수</p>
                          </div>
                          <div>
                            <p className="text-accent text-2xl font-bold">
                              {(info.vectors_count ?? 0).toLocaleString()}
                            </p>
                            <p className="text-text-secondary text-xs">벡터 수</p>
                          </div>
                        </div>
                      )}
                    </NeuCard>
                  )
                })}
              </>
            )}
          </div>

          {/* 집계 파이프라인 상태 */}
          <h2 className="type-label mb-3">집계 파이프라인 상태</h2>
          <NeuCard className="overflow-hidden p-0">
            <table className="w-full">
              <thead>
                <tr className="border-border border-b">
                  {['주기', '이름', '상태', '마지막 실행'].map((h) => (
                    <th
                      key={h}
                      className="text-text-secondary px-4 py-3 text-left text-xs font-semibold tracking-wider uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {PIPELINE_ORDER.map((key) => {
                  const meta = PIPELINE_META[key]
                  const status = aggStatus?.[key]
                  const isRunning = status?.running ?? false
                  const lastRun = status?.last_run
                  const lastStatus = status?.last_status

                  return (
                    <tr key={key} className="hover:bg-[rgba(0,212,255,0.03)]">
                      <td className="px-4 py-3">
                        <span className="text-accent font-mono text-xs font-semibold">
                          {meta.tag}
                        </span>
                      </td>
                      <td className="text-text-primary px-4 py-3 text-sm">{meta.label}</td>
                      <td className="px-4 py-3">
                        {isRunning ? (
                          <div className="flex items-center gap-1.5">
                            <span className="bg-accent inline-block h-2.5 w-2.5 animate-pulse rounded-full" />
                            <span className="text-accent text-xs">실행 중</span>
                          </div>
                        ) : lastStatus === 'error' ? (
                          <div className="flex items-center gap-1.5">
                            <StatusDot status="red" />
                            <span className="text-critical text-xs">오류</span>
                          </div>
                        ) : lastStatus === 'ok' ? (
                          <div className="flex items-center gap-1.5">
                            <StatusDot status="green" />
                            <span className="text-normal text-xs">정상</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <StatusDot status="not_found" />
                            <span className="text-text-disabled text-xs">대기</span>
                          </div>
                        )}
                      </td>
                      <td className="text-text-secondary px-4 py-3 text-sm">
                        {lastRun ? formatRelative(lastRun) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </NeuCard>
        </>
      )}
    </div>
  )
}
