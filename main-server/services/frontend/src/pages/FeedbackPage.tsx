import { useState } from 'react'
import { ChevronLeft, ChevronRight, MessageSquarePlus } from 'lucide-react'
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
import type { AlertHistory } from '@/types/alert'

const PAGE_SIZE = 20
type AckFilter = 'all' | 'unack' | 'ack'

export function FeedbackPage() {
  const [selectedAlert, setSelectedAlert] = useState<AlertHistory | null>(null)
  const [systemFilter, setSystemFilter] = useState<string>('')
  const [ackFilter, setAckFilter] = useState<AckFilter>('all')
  const [offset, setOffset] = useState(0)

  const { data: systems = [] } = useSystems()

  // 페이지네이션용 필터 적용 조회
  const { data: alerts, isLoading, error, refetch } = useAlerts({
    alert_type: 'log_analysis',
    system_id: systemFilter ? Number(systemFilter) : undefined,
    acknowledged: ackFilter === 'all' ? undefined : ackFilter === 'ack',
    limit: PAGE_SIZE,
    offset,
  })

  // 요약 통계용 전체 조회 (limit 넉넉하게)
  const { data: allAlerts = [] } = useAlerts({ alert_type: 'log_analysis', limit: 500 })
  const totalCount = allAlerts.length
  const feedbackableCount = allAlerts.filter((a) => a.qdrant_point_id).length
  const acknowledgedCount = allAlerts.filter((a) => a.acknowledged).length

  const hasNext = (alerts?.length ?? 0) >= PAGE_SIZE
  const hasPrev = offset > 0
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const handleFilterChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value)
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

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <NeuCard className="text-center">
          <p className="text-2xl font-bold text-[#E2E8F2]">{totalCount}</p>
          <p className="text-xs text-[#8B97AD] mt-1">전체 분석 건수</p>
        </NeuCard>
        <NeuCard className="text-center">
          <p className="text-2xl font-bold text-[#00D4FF]">{feedbackableCount}</p>
          <p className="text-xs text-[#8B97AD] mt-1">피드백 제출 가능</p>
        </NeuCard>
        <NeuCard className="text-center">
          <p className="text-2xl font-bold text-[#22C55E]">{acknowledgedCount}</p>
          <p className="text-xs text-[#8B97AD] mt-1">확인 처리 완료</p>
        </NeuCard>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-4">
        <div className="w-48">
          <NeuSelect
            value={systemFilter}
            onChange={handleFilterChange(setSystemFilter)}
          >
            <option value="">전체 시스템</option>
            {systems.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.display_name}
              </option>
            ))}
          </NeuSelect>
        </div>
        <div className="w-36">
          <NeuSelect
            value={ackFilter}
            onChange={handleFilterChange((v) => setAckFilter(v as AckFilter))}
          >
            <option value="all">전체 상태</option>
            <option value="unack">미확인</option>
            <option value="ack">확인됨</option>
          </NeuSelect>
        </div>
      </div>

      {/* 테이블 */}
      {isLoading ? (
        <LoadingSkeleton shape="table" count={8} />
      ) : error ? (
        <ErrorCard onRetry={refetch} />
      ) : (
        <NeuCard className="p-0 overflow-hidden">
          <AlertTable alerts={alerts ?? []} onSelect={setSelectedAlert} />
        </NeuCard>
      )}

      {/* 페이지네이션 */}
      {!isLoading && !error && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-[#8B97AD]">페이지 {currentPage}</span>
          <div className="flex gap-2">
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="w-4 h-4" />
              이전
            </NeuButton>
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={!hasNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              다음
              <ChevronRight className="w-4 h-4" />
            </NeuButton>
          </div>
        </div>
      )}

      {/* 알림 상세 패널 */}
      <AlertDetailPanel
        alert={selectedAlert}
        onClose={() => setSelectedAlert(null)}
      />

      {/* 피드백 제출 플로팅 버튼 — qdrant_point_id 있는 알림 선택 시 표시 */}
      {selectedAlert?.qdrant_point_id && (
        <div className="fixed bottom-6 right-6 z-50">
          <NeuBadge variant="normal" className="mb-2 block text-center text-xs">
            피드백 제출 가능
          </NeuBadge>
          <NeuButton
            variant="primary"
            size="md"
            onClick={() => handleFeedback(selectedAlert)}
          >
            <MessageSquarePlus className="w-4 h-4 mr-1" />
            피드백 제출
          </NeuButton>
        </div>
      )}
    </>
  )
}
