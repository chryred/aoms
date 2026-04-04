import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAlerts } from '@/hooks/queries/useAlerts'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { AlertTable } from '@/components/alert/AlertTable'
import { AlertDetailPanel } from '@/components/alert/AlertDetailPanel'
import { cn } from '@/lib/utils'
import type { AlertHistory, AlertType, Severity } from '@/types/alert'

const PAGE_SIZE = 20
type AckFilter = 'all' | 'unack' | 'ack'
type TabType = 'all' | AlertType

const TABS: { key: TabType; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'metric', label: '메트릭' },
  { key: 'metric_resolved', label: '복구' },
  { key: 'log_analysis', label: '로그분석' },
]

export function AlertHistoryPage() {
  const [tab, setTab] = useState<TabType>('all')
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [ackFilter, setAckFilter] = useState<AckFilter>('all')
  const [offset, setOffset] = useState(0)
  const [selectedAlert, setSelectedAlert] = useState<AlertHistory | null>(null)

  const { data: alerts, isLoading, error, refetch } = useAlerts({
    alert_type: tab === 'all' ? undefined : tab,
    severity: severity || undefined,
    acknowledged: ackFilter === 'all' ? undefined : ackFilter === 'ack',
    limit: PAGE_SIZE,
    offset,
  })

  const hasNext = (alerts?.length ?? 0) >= PAGE_SIZE
  const hasPrev = offset > 0
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const handleTabChange = (t: TabType) => {
    setTab(t)
    setOffset(0)
  }

  return (
    <>
      <PageHeader
        title="알림 이력"
        description="메트릭 알림 및 로그 분석 결과 이력"
      />

      {/* 탭 */}
      <div className="flex gap-1 mb-4 p-1 rounded-xl bg-[#E8EBF0] shadow-[inset_4px_4px_8px_#C8CBD4,inset_-4px_-4px_8px_#FFFFFF] w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
              'focus:outline-none focus:ring-2 focus:ring-[#6366F1]',
              tab === key
                ? 'bg-[#6366F1] text-white shadow-[3px_3px_6px_#C8CBD4,-3px_-3px_6px_#FFFFFF]'
                : 'text-[#4A5568] hover:bg-[rgba(99,102,241,0.08)]'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-4">
        <div className="w-36">
          <NeuSelect
            value={severity}
            onChange={(e) => { setSeverity(e.target.value as Severity | ''); setOffset(0) }}
          >
            <option value="">전체 심각도</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </NeuSelect>
        </div>
        <div className="w-36">
          <NeuSelect
            value={ackFilter}
            onChange={(e) => { setAckFilter(e.target.value as AckFilter); setOffset(0) }}
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
          <AlertTable
            alerts={alerts ?? []}
            onSelect={setSelectedAlert}
          />
        </NeuCard>
      )}

      {/* 페이지네이션 */}
      {!isLoading && !error && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-[#4A5568]">페이지 {currentPage}</span>
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

      {/* 상세 패널 */}
      <AlertDetailPanel
        alert={selectedAlert}
        onClose={() => setSelectedAlert(null)}
      />
    </>
  )
}
