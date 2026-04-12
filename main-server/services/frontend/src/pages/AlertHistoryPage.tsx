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
import type { AlertHistory, Severity } from '@/types/alert'

const PAGE_SIZE = 20
type AckFilter = 'all' | 'unack' | 'ack'
type TabType = 'all' | 'metric' | 'resolved' | 'log_analysis'

const TABS: { key: TabType; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'metric', label: '메트릭' },
  { key: 'resolved', label: '복구' },
  { key: 'log_analysis', label: '로그분석' },
]

export function AlertHistoryPage() {
  const [tab, setTab] = useState<TabType>('all')
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [ackFilter, setAckFilter] = useState<AckFilter>('all')
  const [offset, setOffset] = useState(0)
  const [selectedAlert, setSelectedAlert] = useState<AlertHistory | null>(null)

  const {
    data: alerts,
    isLoading,
    error,
    refetch,
  } = useAlerts({
    alert_type:
      tab === 'all' ? undefined : tab === 'resolved' ? 'metric' : tab,
    resolved: tab === 'metric' ? false : tab === 'resolved' ? true : undefined,
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
      <PageHeader title="알림 이력" description="메트릭 알림 및 로그 분석 결과 이력" />

      {/* 탭 */}
      <div className="mb-4 flex w-fit gap-1 rounded-sm bg-[#1E2127] p-1 shadow-[inset_1px_1px_3px_#111317,inset_-1px_-1px_3px_#2B2F37]">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={cn(
              'rounded-sm px-4 py-1.5 text-sm font-medium transition-all',
              'focus:ring-1 focus:ring-[#00D4FF] focus:ring-offset-[#1E2127] focus:outline-none',
              tab === key
                ? 'bg-[#00D4FF] font-semibold text-[#1E2127] shadow-[2px_2px_4px_#111317]'
                : 'text-[#8B97AD] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#E2E8F2]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="mb-4 flex gap-3">
        <div className="w-36">
          <NeuSelect
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value as Severity | '')
              setOffset(0)
            }}
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
            onChange={(e) => {
              setAckFilter(e.target.value as AckFilter)
              setOffset(0)
            }}
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
        <NeuCard className="overflow-hidden p-0">
          <AlertTable alerts={alerts ?? []} onSelect={setSelectedAlert} />
        </NeuCard>
      )}

      {/* 페이지네이션 */}
      {!isLoading && !error && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-[#8B97AD]">페이지 {currentPage}</span>
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

      {/* 상세 패널 */}
      <AlertDetailPanel alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
    </>
  )
}
