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

// WF 번호 및 한국어 레이블
const PIPELINE_META: Record<AggregationPipelineKey, { wf: string; label: string }> = {
  hourly: { wf: 'WF6', label: '시간별 집계' },
  daily: { wf: 'WF7', label: '일별 집계' },
  weekly: { wf: 'WF8', label: '주간 리포트' },
  monthly: { wf: 'WF9', label: '월간 리포트' },
  longperiod: { wf: 'WF10', label: '장기 리포트' },
  trend: { wf: 'WF11', label: '트렌드 예측' },
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
                      key: 'metric_hourly_patterns',
                      label: 'metric_hourly_patterns',
                      desc: 'WF6 시간별 집계 패턴',
                    },
                    {
                      key: 'aggregation_summaries',
                      label: 'aggregation_summaries',
                      desc: 'WF7~WF10 집계 요약',
                    },
                  ] as const
                ).map(({ key, label, desc }) => {
                  const info = collectionInfo[key]
                  const statusMeta = COLLECTION_STATUS_MAP[info.status] ?? {
                    color: '#5A6478',
                    label: info.status,
                  }
                  return (
                    <NeuCard key={key}>
                      <div className="mb-3 flex items-start justify-between">
                        <div>
                          <p className="mb-0.5 font-mono text-xs text-[#8B97AD]">{label}</p>
                          <p className="text-xs text-[#5A6478]">{desc}</p>
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
                        <p className="text-xs text-[#EF4444]">{info.detail ?? '연결 오류'}</p>
                      ) : (
                        <div className="flex gap-6">
                          <div>
                            <p className="text-2xl font-bold text-[#E2E8F2]">
                              {(info.points_count ?? 0).toLocaleString()}
                            </p>
                            <p className="text-xs text-[#8B97AD]">포인트 수</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-[#00D4FF]">
                              {(info.vectors_count ?? 0).toLocaleString()}
                            </p>
                            <p className="text-xs text-[#8B97AD]">벡터 수</p>
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
                <tr className="border-b border-[#2B2F37]">
                  {['워크플로우', '이름', '상태', '마지막 실행'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-[#8B97AD] uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2B2F37]">
                {PIPELINE_ORDER.map((key) => {
                  const meta = PIPELINE_META[key]
                  const status = aggStatus?.[key]
                  const isRunning = status?.running ?? false
                  const lastRun = status?.last_run
                  const lastStatus = status?.last_status

                  return (
                    <tr key={key} className="hover:bg-[rgba(0,212,255,0.03)]">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold text-[#00D4FF]">
                          {meta.wf}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#E2E8F2]">{meta.label}</td>
                      <td className="px-4 py-3">
                        {isRunning ? (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-[#00D4FF]" />
                            <span className="text-xs text-[#00D4FF]">실행 중</span>
                          </div>
                        ) : lastStatus === 'error' ? (
                          <div className="flex items-center gap-1.5">
                            <StatusDot status="red" />
                            <span className="text-xs text-[#EF4444]">오류</span>
                          </div>
                        ) : lastStatus === 'ok' ? (
                          <div className="flex items-center gap-1.5">
                            <StatusDot status="green" />
                            <span className="text-xs text-[#22C55E]">정상</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <StatusDot status="not_found" />
                            <span className="text-xs text-[#5A6478]">대기</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#8B97AD]">
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
