import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, MessageSquarePlus, RotateCcw } from 'lucide-react'
import { useAlerts } from '@/hooks/queries/useAlerts'
import { useSystems } from '@/hooks/queries/useSystems'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { AlertTable } from '@/components/alert/AlertTable'
import { AlertDetailPanel } from '@/components/alert/AlertDetailPanel'
import { cn } from '@/lib/utils'
import type { AlertHistory } from '@/types/alert'

const PAGE_SIZE = 20
type AckFilter = 'all' | 'unack' | 'ack'
type FeedbackFilter = 'all' | 'feedbackable' | 'ack'

export function FeedbackPage() {
  const [selectedAlert, setSelectedAlert] = useState<AlertHistory | null>(null)
  const [systemFilter, setSystemFilter] = useState<string>('')
  const [ackFilter, setAckFilter] = useState<AckFilter>('all')
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackFilter>('all')
  const [offset, setOffset] = useState(0)

  const { data: systems = [] } = useSystems()

  // 서버 페이지네이션 + 필터 (feedbackFilter='all' 일 때 사용)
  const {
    data: serverAlerts,
    isLoading: isServerLoading,
    error: serverError,
    refetch,
  } = useAlerts({
    alert_type: 'log_analysis',
    system_id: systemFilter ? Number(systemFilter) : undefined,
    acknowledged: ackFilter === 'all' ? undefined : ackFilter === 'ack',
    limit: PAGE_SIZE,
    offset,
  })

  // 요약 통계 + 클라이언트 필터 소스 (feedbackFilter != 'all' 일 때 사용)
  const {
    data: allAlerts = [],
    isLoading: isAllLoading,
    error: allError,
  } = useAlerts({ alert_type: 'log_analysis', limit: 500 })

  const totalCount = allAlerts.length
  const feedbackableCount = allAlerts.filter((a) => a.qdrant_point_id).length
  const acknowledgedCount = allAlerts.filter((a) => a.acknowledged).length

  // feedbackFilter 활성 시 → allAlerts에서 클라이언트 필터 + 시스템/ack 필터 동시 적용
  const isClientFiltered = feedbackFilter !== 'all'
  const filteredBase = useMemo(() => {
    if (!isClientFiltered) return serverAlerts ?? []
    let base = allAlerts
    if (feedbackFilter === 'feedbackable') base = base.filter((a) => a.qdrant_point_id)
    if (feedbackFilter === 'ack') base = base.filter((a) => a.acknowledged)
    if (systemFilter) base = base.filter((a) => a.system_id === Number(systemFilter))
    if (ackFilter !== 'all') base = base.filter((a) => a.acknowledged === (ackFilter === 'ack'))
    return base
  }, [isClientFiltered, serverAlerts, allAlerts, feedbackFilter, systemFilter, ackFilter])

  const displayedAlerts = useMemo(() => {
    if (!isClientFiltered) return filteredBase
    return filteredBase.slice(offset, offset + PAGE_SIZE)
  }, [isClientFiltered, filteredBase, offset])

  const isLoading = isClientFiltered ? isAllLoading : isServerLoading
  const error = isClientFiltered ? allError : serverError

  const hasNext = isClientFiltered
    ? offset + PAGE_SIZE < filteredBase.length
    : (serverAlerts?.length ?? 0) >= PAGE_SIZE
  const hasPrev = offset > 0
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const isFilterActive =
    systemFilter !== '' || ackFilter !== 'all' || feedbackFilter !== 'all'

  const resetFilters = () => {
    setSystemFilter('')
    setAckFilter('all')
    setFeedbackFilter('all')
    setOffset(0)
  }

  const handleSystemChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSystemFilter(e.target.value)
    setOffset(0)
  }
  const handleAckChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setAckFilter(e.target.value as AckFilter)
    setOffset(0)
  }
  const handleFeedbackChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFeedbackFilter(e.target.value as FeedbackFilter)
    setOffset(0)
  }

  const handleCardClick = (next: FeedbackFilter) => {
    setFeedbackFilter((prev) => (prev === next ? 'all' : next))
    setOffset(0)
  }

  const handleFeedback = (alert: AlertHistory) => {
    if (!alert.qdrant_point_id) return
    const systemName = systems.find((s) => s.id === alert.system_id)?.system_name ?? ''
    const url = `/api/v1/feedback/form?alert_id=${alert.id}&system=${encodeURIComponent(systemName)}&point_id=${encodeURIComponent(alert.qdrant_point_id)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <PageHeader
        title="피드백 관리"
        description="로그 분석 알림에 대한 해결책 피드백 제출 및 현황"
      />

      {/* 요약 카드 — 클릭 시 필터 적용 */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => {
            resetFilters()
          }}
          className={cn(
            'focus:ring-accent rounded-sm text-left focus:ring-1 focus:outline-none',
            feedbackFilter === 'all' && !isFilterActive ? '' : '',
          )}
        >
          <NeuCard
            className={cn(
              'text-center transition-shadow',
              feedbackFilter === 'all' && !isFilterActive
                ? 'ring-accent/40 ring-1'
                : 'hover:ring-accent/30 hover:ring-1',
            )}
          >
            <p className="text-text-primary text-2xl font-bold">{totalCount}</p>
            <p className="text-text-secondary mt-1 text-xs">전체 분석 건수</p>
          </NeuCard>
        </button>

        <button
          type="button"
          onClick={() => handleCardClick('feedbackable')}
          className="focus:ring-accent rounded-sm text-left focus:ring-1 focus:outline-none"
        >
          <NeuCard
            className={cn(
              'text-center transition-shadow',
              feedbackFilter === 'feedbackable'
                ? 'ring-accent ring-1'
                : 'hover:ring-accent/30 hover:ring-1',
            )}
          >
            <p className="text-accent text-2xl font-bold">{feedbackableCount}</p>
            <p className="text-text-secondary mt-1 text-xs">피드백 제출 가능</p>
          </NeuCard>
        </button>

        <button
          type="button"
          onClick={() => handleCardClick('ack')}
          className="focus:ring-accent rounded-sm text-left focus:ring-1 focus:outline-none"
        >
          <NeuCard
            className={cn(
              'text-center transition-shadow',
              feedbackFilter === 'ack'
                ? 'ring-accent ring-1'
                : 'hover:ring-accent/30 hover:ring-1',
            )}
          >
            <p className="text-normal text-2xl font-bold">{acknowledgedCount}</p>
            <p className="text-text-secondary mt-1 text-xs">확인 처리 완료</p>
          </NeuCard>
        </button>
      </div>

      {/* 필터 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-48">
          <NeuSelect value={systemFilter} onChange={handleSystemChange}>
            <option value="">전체 시스템</option>
            {systems.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.display_name}
              </option>
            ))}
          </NeuSelect>
        </div>
        <div className="w-36">
          <NeuSelect value={ackFilter} onChange={handleAckChange}>
            <option value="all">전체 상태</option>
            <option value="unack">미확인</option>
            <option value="ack">확인됨</option>
          </NeuSelect>
        </div>
        <div className="w-40">
          <NeuSelect value={feedbackFilter} onChange={handleFeedbackChange}>
            <option value="all">전체 피드백</option>
            <option value="feedbackable">피드백 가능</option>
            <option value="ack">확인 완료</option>
          </NeuSelect>
        </div>
        <NeuButton
          variant="ghost"
          size="sm"
          disabled={!isFilterActive}
          onClick={resetFilters}
        >
          <RotateCcw className="mr-1 h-4 w-4" />
          필터 초기화
        </NeuButton>
      </div>

      {/* 테이블 */}
      {isLoading ? (
        <LoadingSkeleton shape="table" count={8} />
      ) : error ? (
        <ErrorCard onRetry={refetch} />
      ) : (
        <NeuCard className="overflow-hidden p-0">
          <AlertTable alerts={displayedAlerts} onSelect={setSelectedAlert} />
        </NeuCard>
      )}

      {/* 페이지네이션 */}
      {!isLoading && !error && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-text-secondary text-sm">페이지 {currentPage}</span>
          <div className="flex gap-2">
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="h-4 w-4" />
              이전
            </NeuButton>
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={!hasNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              다음
              <ChevronRight className="h-4 w-4" />
            </NeuButton>
          </div>
        </div>
      )}

      {/* 알림 상세 패널 */}
      <AlertDetailPanel alert={selectedAlert} onClose={() => setSelectedAlert(null)} />

      {/* 피드백 제출 플로팅 버튼 — qdrant_point_id 있는 알림 선택 시 표시 */}
      {selectedAlert?.qdrant_point_id && (
        <div className="fixed right-6 bottom-6 z-50">
          <NeuBadge variant="normal" className="mb-2 block text-center text-xs">
            피드백 제출 가능
          </NeuBadge>
          <NeuButton variant="primary" size="md" onClick={() => handleFeedback(selectedAlert)}>
            <MessageSquarePlus className="mr-1 h-4 w-4" />
            피드백 제출
          </NeuButton>
        </div>
      )}
    </>
  )
}
