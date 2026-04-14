import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAlerts } from '@/hooks/queries/useAlerts'
import { useSystems } from '@/hooks/queries/useSystems'
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

const isSeverity = (v: string): v is Severity =>
  v === 'critical' || v === 'warning' || v === 'info'
const isAckFilter = (v: string): v is AckFilter => v === 'all' || v === 'unack' || v === 'ack'

export function AlertHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const systemFilter = searchParams.get('system_id') ?? ''
  const severityParam = searchParams.get('severity') ?? ''
  const ackParam = searchParams.get('acknowledged') ?? 'all'

  const severity: Severity | '' = isSeverity(severityParam) ? severityParam : ''
  const ackFilter: AckFilter = isAckFilter(ackParam) ? ackParam : 'all'

  const [tab, setTab] = useState<TabType>('all')
  const [offset, setOffset] = useState(0)
  const [selectedAlert, setSelectedAlert] = useState<AlertHistory | null>(null)

  const { data: systems = [] } = useSystems()

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
    setOffset(0)
  }

  const {
    data: alerts,
    isLoading,
    error,
    refetch,
  } = useAlerts({
    alert_type: tab === 'all' ? undefined : tab === 'resolved' ? 'metric' : tab,
    resolved: tab === 'metric' ? false : tab === 'resolved' ? true : undefined,
    severity: severity || undefined,
    acknowledged: ackFilter === 'all' ? undefined : ackFilter === 'ack',
    system_id: systemFilter ? Number(systemFilter) : undefined,
    limit: PAGE_SIZE,
    offset,
  })

  const handleSystemChange = (e: React.ChangeEvent<HTMLSelectElement>) =>
    updateParam('system_id', e.target.value)

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
      <div className="bg-bg-base shadow-neu-pressed mb-4 flex w-fit gap-1 rounded-sm p-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={cn(
              'rounded-sm px-4 py-1.5 text-sm font-medium transition-all',
              'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:outline-none',
              tab === key
                ? 'bg-accent text-accent-contrast shadow-neu-flat font-semibold'
                : 'text-text-secondary hover:bg-hover-subtle hover:text-text-primary',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="mb-4 flex flex-wrap gap-3">
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
          <NeuSelect
            value={severity}
            onChange={(e) => updateParam('severity', e.target.value)}
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
            onChange={(e) => updateParam('acknowledged', e.target.value === 'all' ? '' : e.target.value)}
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

      {/* 상세 패널 */}
      <AlertDetailPanel alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
    </>
  )
}
