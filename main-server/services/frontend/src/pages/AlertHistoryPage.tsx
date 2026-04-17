import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bell, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useAlerts } from '@/hooks/queries/useAlerts'
import { useAlertsCount } from '@/hooks/queries/useAlertsCount'
import { useSystems } from '@/hooks/queries/useSystems'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { EmptyState } from '@/components/common/EmptyState'
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
  { key: 'resolved', label: '복구됨' },
  { key: 'log_analysis', label: '로그분석' },
]

const isSeverity = (v: string): v is Severity => v === 'critical' || v === 'warning' || v === 'info'
const isAckFilter = (v: string): v is AckFilter => v === 'all' || v === 'unack' || v === 'ack'

// KST 날짜 선택값을 UTC naive datetime 문자열로 변환 (백엔드 저장 형식과 일치)
const kstDateToUtcStart = (d: string) =>
  new Date(d + 'T00:00:00+09:00').toISOString().replace('.000Z', '')
const kstDateToUtcEnd = (d: string) =>
  new Date(d + 'T23:59:59+09:00').toISOString().replace('.000Z', '')

export function AlertHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const systemFilter = searchParams.get('system_id') ?? ''
  const severityParam = searchParams.get('severity') ?? ''
  const ackParam = searchParams.get('acknowledged') ?? 'all'
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''

  const severity: Severity | '' = isSeverity(severityParam) ? severityParam : ''
  const ackFilter: AckFilter = isAckFilter(ackParam) ? ackParam : 'all'

  const [tab, setTab] = useState<TabType>('all')
  const [offset, setOffset] = useState(0)
  const [selectedAlert, setSelectedAlert] = useState<AlertHistory | null>(null)

  // 슬라이딩 탭 인디케이터
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  const { data: systems = [] } = useSystems()

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
    setOffset(0)
  }

  const clearAllFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true })
    setOffset(0)
  }

  const baseQueryParams = {
    alert_type: tab === 'all' ? undefined : tab === 'resolved' ? 'metric' : tab,
    resolved: tab === 'metric' ? false : tab === 'resolved' ? true : undefined,
    severity: severity || undefined,
    acknowledged: ackFilter === 'all' ? undefined : ackFilter === 'ack',
    system_id: systemFilter ? Number(systemFilter) : undefined,
    date_from: dateFrom ? kstDateToUtcStart(dateFrom) : undefined,
    date_to: dateTo ? kstDateToUtcEnd(dateTo) : undefined,
  }

  const {
    data: alerts,
    isLoading,
    error,
    refetch,
  } = useAlerts({ ...baseQueryParams, limit: PAGE_SIZE, offset })

  const { data: countData } = useAlertsCount(baseQueryParams)
  const totalCount = countData?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const hasPrev = offset > 0
  const hasNext = (alerts?.length ?? 0) >= PAGE_SIZE
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const handleTabChange = (t: TabType) => {
    setTab(t)
    setOffset(0)
  }

  useEffect(() => {
    const idx = TABS.findIndex((t) => t.key === tab)
    const btn = tabRefs.current[idx]
    if (!btn) return
    const { offsetLeft: left, offsetWidth: width } = btn
    setIndicator((prev) => ({ left, width, ready: prev.ready }))
    // 첫 측정 후 한 프레임 뒤에 transition 활성화 (초기 jump 방지)
    if (!indicator.ready) {
      requestAnimationFrame(() => setIndicator({ left, width, ready: true }))
    }
  }, [tab, indicator.ready])

  const hasActiveFilters = !!(systemFilter || severity || ackFilter !== 'all' || dateFrom || dateTo)

  const activeFilterChips = useMemo(() => {
    const chips: { label: string; onClear: () => void }[] = []
    if (systemFilter) {
      const sys = systems.find((s) => s.id === Number(systemFilter))
      chips.push({
        label: sys?.display_name ?? '시스템',
        onClear: () => updateParam('system_id', ''),
      })
    }
    if (severity) {
      const labels: Record<string, string> = {
        critical: 'Critical',
        warning: 'Warning',
        info: 'Info',
      }
      chips.push({
        label: labels[severity] ?? severity,
        onClear: () => updateParam('severity', ''),
      })
    }
    if (ackFilter !== 'all') {
      chips.push({
        label: ackFilter === 'ack' ? '확인됨' : '미확인',
        onClear: () => updateParam('acknowledged', ''),
      })
    }
    if (dateFrom)
      chips.push({ label: `${dateFrom}부터`, onClear: () => updateParam('date_from', '') })
    if (dateTo) chips.push({ label: `${dateTo}까지`, onClear: () => updateParam('date_to', '') })
    return chips
    // updateParam은 searchParams 변경 시 재생성되므로, searchParams 파생값이 deps에 포함되면 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemFilter, severity, ackFilter, dateFrom, dateTo, systems])

  return (
    <>
      <PageHeader title="알림 이력" />

      {/* 탭 */}
      <div
        role="tablist"
        aria-label="알림 유형"
        className="bg-bg-base shadow-neu-pressed relative mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-sm p-1"
      >
        {/* 슬라이딩 배경 인디케이터 */}
        <span
          aria-hidden="true"
          className="shadow-neu-flat bg-accent pointer-events-none absolute rounded-sm"
          style={{
            top: 4,
            bottom: 4,
            left: indicator.left,
            width: indicator.width,
            opacity: indicator.ready ? 1 : 0,
            transition: indicator.ready
              ? 'left 0.22s cubic-bezier(0.25, 1, 0.5, 1), width 0.22s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.12s ease'
              : 'none',
          }}
        />
        {TABS.map(({ key, label }, i) => (
          <button
            key={key}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            role="tab"
            aria-selected={tab === key}
            onClick={() => handleTabChange(key)}
            className={cn(
              'relative z-10 rounded-sm px-4 py-2.5 text-sm font-medium',
              'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:outline-none',
              'transition-colors duration-150',
              tab === key
                ? 'text-accent-contrast font-semibold'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="mb-2 flex flex-wrap gap-3">
        <div className="w-48">
          <NeuSelect
            aria-label="시스템 필터"
            value={systemFilter}
            onChange={(e) => updateParam('system_id', e.target.value)}
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
            aria-label="심각도 필터"
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
            aria-label="확인 상태 필터"
            value={ackFilter}
            onChange={(e) =>
              updateParam('acknowledged', e.target.value === 'all' ? '' : e.target.value)
            }
          >
            <option value="all">전체 상태</option>
            <option value="unack">미확인</option>
            <option value="ack">확인됨</option>
          </NeuSelect>
        </div>
        <div className="w-40">
          <NeuInput
            type="date"
            aria-label="시작 날짜 (KST)"
            value={dateFrom}
            onChange={(e) => updateParam('date_from', e.target.value)}
          />
        </div>
        <div className="w-40">
          <NeuInput
            type="date"
            aria-label="종료 날짜 (KST)"
            value={dateTo}
            onChange={(e) => updateParam('date_to', e.target.value)}
          />
        </div>
      </div>

      {/* 활성 필터 칩 */}
      {activeFilterChips.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {activeFilterChips.map(({ label, onClear }) => (
            <span
              key={label}
              className="border-accent bg-accent-muted text-accent flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs"
            >
              {label}
              <button
                onClick={onClear}
                aria-label={`${label} 필터 제거`}
                className="ml-0.5 opacity-70 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            onClick={clearAllFilters}
            className="text-text-secondary hover:text-text-primary text-xs underline underline-offset-2"
          >
            전체 초기화
          </button>
        </div>
      )}

      {/* 스크린리더용 필터 결과 상태 알림 */}
      <span className="sr-only" aria-live="polite">
        {!isLoading && !error ? `${totalCount}개 알림 표시 중` : ''}
      </span>

      {/* 테이블 */}
      {isLoading ? (
        <LoadingSkeleton shape="table" count={8} />
      ) : error ? (
        <ErrorCard onRetry={refetch} />
      ) : alerts?.length === 0 ? (
        <div key={tab} className="animate-fade-in-up-subtle">
          <EmptyState
            icon={<Bell className="h-10 w-10" />}
            title={hasActiveFilters ? '조건에 맞는 알림이 없습니다' : '알림 이력이 없습니다'}
            description={hasActiveFilters ? '필터를 조정하거나 초기화해 보세요' : undefined}
            cta={hasActiveFilters ? { label: '필터 초기화', onClick: clearAllFilters } : undefined}
          />
        </div>
      ) : (
        <NeuCard key={tab} className="animate-fade-in-up-subtle overflow-hidden p-0">
          <AlertTable alerts={alerts ?? []} onSelect={setSelectedAlert} />
        </NeuCard>
      )}

      {/* 페이지네이션 */}
      {!isLoading && !error && (alerts?.length ?? 0) > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-text-secondary text-sm">
            페이지 {currentPage} / {totalPages}
            {totalCount > 0 && (
              <span className="text-text-disabled ml-1.5">
                (총 {totalCount.toLocaleString()}건)
              </span>
            )}
          </span>
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
