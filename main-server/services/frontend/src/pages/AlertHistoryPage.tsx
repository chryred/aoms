import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Ban, Bell, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react'
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
import { cn, kstDateToUtcStart, kstDateToUtcEnd, formatKST } from '@/lib/utils'
import type { AlertHistory, Severity } from '@/types/alert'
import { alertExclusionsApi, type AlertExclusion } from '@/api/alertExclusions'
import { useAuthStore } from '@/store/authStore'

const PAGE_SIZE = 20
type AckFilter = 'all' | 'unack' | 'ack'
type TabType = 'all' | 'metric' | 'resolved' | 'log_analysis' | 'exclusions'

const TABS: { key: TabType; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'metric', label: '메트릭' },
  { key: 'resolved', label: '복구됨' },
  { key: 'log_analysis', label: '로그분석' },
  { key: 'exclusions', label: '예외 처리됨' },
]

const isSeverity = (v: string): v is Severity => v === 'critical' || v === 'warning' || v === 'info'
const isAckFilter = (v: string): v is AckFilter => v === 'all' || v === 'unack' || v === 'ack'

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

  // 체크박스 선택 상태
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // 예외 처리 모달
  const [showExcludeModal, setShowExcludeModal] = useState(false)
  const [excludeReason, setExcludeReason] = useState('')
  const [includeRole, setIncludeRole] = useState(true)
  const [maxCountInput, setMaxCountInput] = useState('')   // count 임계값 (빈문자열 = 무제한)
  const [expiryOption, setExpiryOption] = useState<'30' | '7' | '90' | 'custom' | 'never'>('30')
  const [customExpiryDate, setCustomExpiryDate] = useState('')   // YYYY-MM-DD (KST)
  const [isExcluding, setIsExcluding] = useState(false)
  const [excludeResultMsg, setExcludeResultMsg] = useState<string | null>(null)

  // 예외 처리됨 탭 데이터
  const [exclusions, setExclusions] = useState<AlertExclusion[]>([])
  const [exclusionsLoading, setExclusionsLoading] = useState(false)
  const [selectedExclusionIds, setSelectedExclusionIds] = useState<Set<number>>(new Set())
  const [isDeactivating, setIsDeactivating] = useState(false)

  const { user } = useAuthStore()

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
    alert_type: tab === 'all' || tab === 'exclusions' ? undefined : tab === 'resolved' ? 'metric' : tab,
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
  } = useAlerts(
    tab === 'exclusions' ? { limit: 0, offset: 0 } : { ...baseQueryParams, limit: PAGE_SIZE, offset }
  )

  const { data: countData } = useAlertsCount(tab === 'exclusions' ? {} : baseQueryParams)
  const totalCount = countData?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const hasPrev = offset > 0
  const hasNext = (alerts?.length ?? 0) >= PAGE_SIZE
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const handleTabChange = (t: TabType) => {
    setTab(t)
    setOffset(0)
    setSelectedIds(new Set())
    if (t === 'exclusions') loadExclusions()
  }

  const loadExclusions = useCallback(async () => {
    setExclusionsLoading(true)
    try {
      const params = systemFilter ? { system_id: Number(systemFilter), active: 'all' as const } : { active: 'all' as const }
      const data = await alertExclusionsApi.listExclusions(params)
      setExclusions(data)
    } catch {
      /* silent */
    } finally {
      setExclusionsLoading(false)
    }
  }, [systemFilter])

  useEffect(() => {
    if (tab === 'exclusions') loadExclusions()
  }, [tab, loadExclusions])

  useEffect(() => {
    const idx = TABS.findIndex((t) => t.key === tab)
    const btn = tabRefs.current[idx]
    if (!btn) return
    const { offsetLeft: left, offsetWidth: width } = btn
    setIndicator((prev) => ({ left, width, ready: prev.ready }))
    if (!indicator.ready) {
      requestAnimationFrame(() => setIndicator({ left, width, ready: true }))
    }
  }, [tab, indicator.ready])

  const [isRefreshing, setIsRefreshing] = useState(false)
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      if (tab === 'exclusions') await loadExclusions()
      else await refetch()
    } finally {
      setIsRefreshing(false)
    }
  }, [refetch, tab, loadExclusions])

  const hasActiveFilters = !!(systemFilter || severity || ackFilter !== 'all' || dateFrom || dateTo)

  const activeFilterChips = useMemo(() => {
    const chips: { label: string; onClear: () => void }[] = []
    if (systemFilter) {
      const sys = systems.find((s) => s.id === Number(systemFilter))
      chips.push({ label: sys?.display_name ?? '시스템', onClear: () => updateParam('system_id', '') })
    }
    if (severity) {
      const labels: Record<string, string> = { critical: 'Critical', warning: 'Warning', info: 'Info' }
      chips.push({ label: labels[severity] ?? severity, onClear: () => updateParam('severity', '') })
    }
    if (ackFilter !== 'all') {
      chips.push({ label: ackFilter === 'ack' ? '확인됨' : '미확인', onClear: () => updateParam('acknowledged', '') })
    }
    if (dateFrom) chips.push({ label: `${dateFrom}부터`, onClear: () => updateParam('date_from', '') })
    if (dateTo) chips.push({ label: `${dateTo}까지`, onClear: () => updateParam('date_to', '') })
    return chips
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemFilter, severity, ackFilter, dateFrom, dateTo, systems])

  // 체크박스 핸들러
  const currentAlerts = tab === 'exclusions' ? [] : (alerts ?? [])
  const logAnalysisAlerts = currentAlerts.filter((a) => a.alert_type === 'log_analysis')
  const allLogAnalysisSelected =
    logAnalysisAlerts.length > 0 && logAnalysisAlerts.every((a) => selectedIds.has(a.id))

  const toggleSelectAll = () => {
    if (allLogAnalysisSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(logAnalysisAlerts.map((a) => a.id)))
    }
  }

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedLogAnalysisCount = currentAlerts.filter(
    (a) => selectedIds.has(a.id) && a.alert_type === 'log_analysis'
  ).length

  const hasNonLogAnalysisSelected = currentAlerts.some(
    (a) => selectedIds.has(a.id) && a.alert_type !== 'log_analysis'
  )

  // 만료 옵션 → ISO UTC 변환
  const computeExpiresAt = (): string | null => {
    if (expiryOption === 'never') return null
    if (expiryOption === 'custom') {
      if (!customExpiryDate) return null
      // KST 기준 자정 → UTC ISO. kstDateToUtcEnd: KST 23:59:59 → UTC ISO
      return kstDateToUtcEnd(customExpiryDate)
    }
    // '30' | '7' | '90' — N일 후 자정 (현재 시각 기준 N*86400000 ms)
    const days = parseInt(expiryOption, 10)
    const target = new Date(Date.now() + days * 86400000)
    return target.toISOString()
  }

  // 예외 처리 실행
  const handleBulkExclude = async () => {
    const alertIds = currentAlerts
      .filter((a) => selectedIds.has(a.id) && a.alert_type === 'log_analysis')
      .map((a) => a.id)

    if (alertIds.length === 0) return
    setIsExcluding(true)
    try {
      const maxCount = maxCountInput.trim() === '' ? null : Number(maxCountInput)
      if (maxCount !== null && (!Number.isFinite(maxCount) || maxCount < 1)) {
        setExcludeResultMsg('임계값은 1 이상의 정수여야 합니다.')
        setIsExcluding(false)
        return
      }
      const result = await alertExclusionsApi.bulkExcludeAlerts({
        alert_ids: alertIds,
        reason: excludeReason || null,
        include_instance_role: includeRole,
        created_by: user?.name ?? null,
        max_count_per_window: maxCount,
        expires_at: computeExpiresAt(),
      })
      const msg = `예외 처리 완료: 규칙 ${result.succeeded.length}건 등록${result.failed.length > 0 ? `, ${result.failed.length}건 실패` : ''}`
      setExcludeResultMsg(msg)
      setSelectedIds(new Set())
      setShowExcludeModal(false)
      setExcludeReason('')
      setMaxCountInput('')
      setExpiryOption('30')
      setCustomExpiryDate('')
    } catch {
      setExcludeResultMsg('예외 처리 중 오류가 발생했습니다.')
    } finally {
      setIsExcluding(false)
    }
  }

  // 예외 해제 실행
  const handleBulkDeactivate = async () => {
    if (selectedExclusionIds.size === 0) return
    setIsDeactivating(true)
    try {
      await alertExclusionsApi.deactivateExclusions({
        ids: Array.from(selectedExclusionIds),
        deactivated_by: user?.name ?? null,
      })
      setSelectedExclusionIds(new Set())
      await loadExclusions()
    } catch {
      /* silent */
    } finally {
      setIsDeactivating(false)
    }
  }

  const handleSingleDeactivate = async (id: number) => {
    try {
      await alertExclusionsApi.deactivateExclusions({ ids: [id], deactivated_by: user?.name ?? null })
      await loadExclusions()
    } catch {
      /* silent */
    }
  }

  const toggleExclusionSelect = (id: number) => {
    setSelectedExclusionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 만료 여부 판정 (lazy: 클라이언트 측에서 계산)
  const isExclusionExpired = (ex: AlertExclusion): boolean => {
    if (!ex.expires_at) return false
    const normalized =
      !ex.expires_at.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(ex.expires_at)
        ? ex.expires_at + 'Z'
        : ex.expires_at
    return new Date(normalized).getTime() <= Date.now()
  }

  const toggleSelectAllExclusions = () => {
    // 활성 + 미만료 규칙만 선택 가능
    const eligibleIds = exclusions.filter((e) => e.active && !isExclusionExpired(e)).map((e) => e.id)
    if (eligibleIds.length > 0 && eligibleIds.every((id) => selectedExclusionIds.has(id))) {
      setSelectedExclusionIds(new Set())
    } else {
      setSelectedExclusionIds(new Set(eligibleIds))
    }
  }

  return (
    <>
      <PageHeader
        title="알림 이력"
        action={
          <NeuButton size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            새로고침
          </NeuButton>
        }
      />

      {/* 탭 */}
      <div
        role="tablist"
        aria-label="알림 유형"
        className="bg-bg-base shadow-neu-pressed relative mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-sm p-1"
      >
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
            ref={(el) => { tabRefs.current[i] = el }}
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

      {/* 예외 처리됨 탭 */}
      {tab === 'exclusions' ? (
        <>
          {/* 일괄 액션 바 (선택된 경우) */}
          {selectedExclusionIds.size > 0 && (
            <div className="bg-surface shadow-neu-flat mb-3 flex items-center gap-3 rounded-sm px-4 py-2.5">
              <span className="text-text-primary text-sm font-medium">
                {selectedExclusionIds.size}건 선택됨
              </span>
              <NeuButton
                size="sm"
                variant="ghost"
                onClick={handleBulkDeactivate}
                disabled={isDeactivating}
              >
                {isDeactivating ? '해제 중...' : '선택 해제'}
              </NeuButton>
              <NeuButton
                size="sm"
                variant="ghost"
                onClick={() => setSelectedExclusionIds(new Set())}
              >
                선택 취소
              </NeuButton>
            </div>
          )}

          {exclusionsLoading ? (
            <LoadingSkeleton shape="table" count={6} />
          ) : exclusions.length === 0 ? (
            <EmptyState
              icon={<Ban className="h-10 w-10" />}
              title="예외 처리된 알림이 없습니다"
              description="알림 이력에서 '예외 처리' 버튼으로 등록할 수 있습니다"
            />
          ) : (
            <NeuCard className="overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border border-b">
                    <th className="w-10 px-3 py-3 text-left">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={
                          exclusions.filter((e) => e.active && !isExclusionExpired(e)).length > 0 &&
                          exclusions.filter((e) => e.active && !isExclusionExpired(e)).every((e) => selectedExclusionIds.has(e.id))
                        }
                        onChange={toggleSelectAllExclusions}
                      />
                    </th>
                    <th className="text-text-secondary px-3 py-3 text-left font-medium">시스템</th>
                    <th className="text-text-secondary px-3 py-3 text-left font-medium">Role</th>
                    <th className="text-text-secondary px-3 py-3 text-left font-medium">Template</th>
                    <th className="text-text-secondary px-3 py-3 text-left font-medium">사유</th>
                    <th className="text-text-secondary px-3 py-3 text-center font-medium">임계값</th>
                    <th className="text-text-secondary px-3 py-3 text-left font-medium">만료</th>
                    <th className="text-text-secondary px-3 py-3 text-left font-medium">등록일시</th>
                    <th className="text-text-secondary px-3 py-3 text-center font-medium">Skip</th>
                    <th className="text-text-secondary px-3 py-3 text-left font-medium">상태</th>
                    <th className="w-20 px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {exclusions.map((ex) => {
                    const sys = systems.find((s) => s.id === ex.system_id)
                    const expired = isExclusionExpired(ex)
                    const canDeactivate = ex.active && !expired
                    return (
                      <tr key={ex.id} className="border-border hover:bg-surface/50 border-b last:border-0">
                        <td className="px-3 py-2.5">
                          {canDeactivate && (
                            <input
                              type="checkbox"
                              className="accent-accent"
                              checked={selectedExclusionIds.has(ex.id)}
                              onChange={() => toggleExclusionSelect(ex.id)}
                            />
                          )}
                        </td>
                        <td className="text-text-primary px-3 py-2.5 font-medium">
                          {sys?.display_name ?? `ID:${ex.system_id}`}
                        </td>
                        <td className="text-text-secondary px-3 py-2.5">
                          {ex.instance_role ?? <span className="text-text-disabled">전체</span>}
                        </td>
                        <td className="text-text-primary max-w-xs px-3 py-2.5">
                          <span title={ex.template} className="block truncate font-mono text-xs">
                            {ex.template}
                          </span>
                        </td>
                        <td className="text-text-secondary max-w-[160px] px-3 py-2.5">
                          <span className="block truncate">{ex.reason ?? '—'}</span>
                        </td>
                        <td className="text-text-primary px-3 py-2.5 text-center">
                          {ex.max_count_per_window != null ? (
                            <span className="font-mono text-xs">{ex.max_count_per_window}건/5분</span>
                          ) : (
                            <span className="text-text-disabled text-xs">무제한</span>
                          )}
                        </td>
                        <td className="text-text-secondary px-3 py-2.5 whitespace-nowrap">
                          {ex.expires_at ? formatKST(ex.expires_at, 'date') : (
                            <span className="text-text-disabled">없음</span>
                          )}
                        </td>
                        <td className="text-text-secondary px-3 py-2.5 whitespace-nowrap">
                          {formatKST(ex.created_at, 'datetime')}
                        </td>
                        <td className="text-text-primary px-3 py-2.5 text-center">
                          {ex.skip_count}
                        </td>
                        <td className="px-3 py-2.5">
                          {!ex.active ? (
                            <span className="text-text-disabled text-xs">해제됨</span>
                          ) : expired ? (
                            <span className="text-warning text-xs font-medium">만료</span>
                          ) : (
                            <span className="text-normal text-xs font-medium">활성</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {canDeactivate && (
                            <NeuButton
                              size="sm"
                              variant="ghost"
                              onClick={() => handleSingleDeactivate(ex.id)}
                              className="text-xs"
                            >
                              해제
                            </NeuButton>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </NeuCard>
          )}
        </>
      ) : (
        <>
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

          {/* 일괄 액션 바 */}
          {selectedIds.size > 0 && (
            <div className="bg-surface shadow-neu-flat mb-3 flex items-center gap-3 rounded-sm px-4 py-2.5">
              <span className="text-text-primary text-sm font-medium">
                {selectedIds.size}건 선택됨
                {selectedLogAnalysisCount < selectedIds.size && (
                  <span className="text-text-secondary ml-2 text-xs">
                    (로그분석 {selectedLogAnalysisCount}건만 예외 처리 가능)
                  </span>
                )}
              </span>
              <NeuButton
                size="sm"
                onClick={() => {
                  if (hasNonLogAnalysisSelected || selectedLogAnalysisCount === 0) return
                  setShowExcludeModal(true)
                }}
                disabled={selectedLogAnalysisCount === 0 || hasNonLogAnalysisSelected}
                title={
                  hasNonLogAnalysisSelected
                    ? '메트릭 알림은 예외 처리 대상이 아닙니다'
                    : selectedLogAnalysisCount === 0
                      ? '로그분석 알림을 선택하세요'
                      : undefined
                }
              >
                <Ban className="h-3.5 w-3.5" />
                선택 예외 처리
              </NeuButton>
              <NeuButton
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
              >
                선택 취소
              </NeuButton>
            </div>
          )}

          {/* 토스트 메시지 */}
          {excludeResultMsg && (
            <div className="bg-surface border-border mb-3 flex items-center justify-between rounded-sm border px-4 py-2.5 text-sm">
              <span className="text-text-primary">{excludeResultMsg}</span>
              <button
                onClick={() => setExcludeResultMsg(null)}
                className="text-text-secondary hover:text-text-primary ml-3"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <span className="sr-only" aria-live="polite">
            {!isLoading && !error ? `${totalCount}개 알림 표시 중` : ''}
          </span>

          {/* 테이블 */}
          {isLoading ? (
            <LoadingSkeleton shape="table" count={8} />
          ) : error ? (
            <ErrorCard onRetry={refetch} />
          ) : currentAlerts.length === 0 ? (
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
              {/* 전체 선택 체크박스 헤더 */}
              <div className="border-border flex items-center gap-3 border-b px-4 py-2">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={allLogAnalysisSelected && logAnalysisAlerts.length > 0}
                  onChange={toggleSelectAll}
                  disabled={logAnalysisAlerts.length === 0}
                  aria-label="로그분석 알림 전체 선택"
                />
                <span className="text-text-secondary text-xs">
                  {logAnalysisAlerts.length > 0
                    ? `로그분석 ${logAnalysisAlerts.length}건 선택 가능`
                    : '선택 가능한 로그분석 알림 없음'}
                </span>
              </div>
              <AlertTable
                alerts={currentAlerts}
                onSelect={setSelectedAlert}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />
            </NeuCard>
          )}

          {/* 페이지네이션 */}
          {!isLoading && !error && currentAlerts.length > 0 && (
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
        </>
      )}

      {/* 예외 처리 모달 */}
      {showExcludeModal && (
        <div className="bg-overlay fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="bg-surface shadow-neu-flat w-full max-w-md rounded-sm p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exclude-modal-title"
          >
            <h3 id="exclude-modal-title" className="text-text-primary mb-4 text-base font-semibold">
              예외 처리 등록
            </h3>
            <p className="text-text-secondary mb-4 text-sm">
              선택한 로그분석 알림 {selectedLogAnalysisCount}건의 template을 예외 목록에 등록합니다.
              이후 동일한 에러 패턴은 알림/인시던트가 생성되지 않습니다.
            </p>
            <div className="mb-4">
              <label className="text-text-secondary mb-1.5 block text-xs font-medium">사유 (선택)</label>
              <NeuInput
                placeholder="예: 알려진 배치 작업 로그, 무시 가능"
                value={excludeReason}
                onChange={(e) => setExcludeReason(e.target.value)}
              />
            </div>

            <div className="mb-4">
              <label className="text-text-secondary mb-1.5 block text-xs font-medium">
                발생 건수 임계값 (선택)
              </label>
              <NeuInput
                type="number"
                min={1}
                placeholder="비워두면 무제한 (모든 건수에 예외 적용)"
                value={maxCountInput}
                onChange={(e) => setMaxCountInput(e.target.value)}
              />
              <p className="text-text-disabled mt-1 text-xs">
                5분 윈도우 내 발생 건수가 이 값 이하일 때만 예외 처리됩니다. 초과 시 정상 알림 발생.
              </p>
            </div>

            <div className="mb-4">
              <label className="text-text-secondary mb-1.5 block text-xs font-medium">자동 만료</label>
              <NeuSelect
                value={expiryOption}
                onChange={(e) => setExpiryOption(e.target.value as typeof expiryOption)}
              >
                <option value="30">30일 후 자동 해제 (권장)</option>
                <option value="7">7일 후 자동 해제</option>
                <option value="90">90일 후 자동 해제</option>
                <option value="custom">날짜 직접 지정</option>
                <option value="never">만료 없음</option>
              </NeuSelect>
              {expiryOption === 'custom' && (
                <NeuInput
                  type="date"
                  className="mt-2"
                  value={customExpiryDate}
                  onChange={(e) => setCustomExpiryDate(e.target.value)}
                />
              )}
            </div>

            <div className="mb-6 flex items-center gap-2">
              <input
                id="includeRole"
                type="checkbox"
                className="accent-accent"
                checked={includeRole}
                onChange={(e) => setIncludeRole(e.target.checked)}
              />
              <label htmlFor="includeRole" className="text-text-secondary cursor-pointer text-sm">
                instance_role 포함 (역할별 제한, 해제 시 시스템 전체 적용)
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <NeuButton
                variant="ghost"
                onClick={() => {
                  setShowExcludeModal(false)
                  setExcludeReason('')
                  setMaxCountInput('')
                  setExpiryOption('30')
                  setCustomExpiryDate('')
                }}
              >
                취소
              </NeuButton>
              <NeuButton onClick={handleBulkExclude} disabled={isExcluding}>
                {isExcluding ? '등록 중...' : '예외 등록'}
              </NeuButton>
            </div>
          </div>
        </div>
      )}

      {/* 상세 패널 */}
      <AlertDetailPanel alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
    </>
  )
}
