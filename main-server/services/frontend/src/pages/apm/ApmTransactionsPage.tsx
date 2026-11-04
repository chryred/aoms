import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { HTTPError } from 'ky'
import { SearchX } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorCard } from '@/components/common/ErrorCard'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Columns3, X } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { TxFilterBar, type TxFilters } from '@/components/apm/TxFilterBar'
import { TxTable, type TxSort } from '@/components/apm/TxTable'
import { TxScatterChart } from '@/components/apm/TxScatterChart'
import { inBrush, txKey, type TxBrush } from '@/lib/apm/txUtils'
import { TxStatsTab } from '@/components/apm/tx/TxStatsTab'
import { TxHourlyChart } from '@/components/apm/tx/TxHourlyChart'
import { TxCallTreeTab } from '@/components/apm/detail/TxCallTreeTab'
import { ROUTES } from '@/constants/routes'
import { useApmTransactions } from '@/hooks/queries/useApmTransactions'
import { useApmTransactionDetail } from '@/hooks/queries/useApmTransactionDetail'
import { useApmTxHourly } from '@/hooks/queries/useApmTxHourly'
import { useApmTxStats } from '@/hooks/queries/useApmTxStats'
import { useSystems } from '@/hooks/queries/useSystems'
import { TOGGLEABLE_COLS, useTxColumns } from '@/hooks/useTxColumns'
import { useAuthStore } from '@/store/authStore'
import { cn, formatKST, kstDateToUtcEnd, kstDateToUtcStart } from '@/lib/utils'
import type { TxFilterParams, TxListParams, TxOrderBy, TxSummary } from '@/types/apm'

const PAGE_SIZE = 100
const STATS_LIMIT = 50
const DEFAULT_SORT: TxSort = { by: 'elapsed_ms', order: 'desc' }
const ORDER_BYS: TxOrderBy[] = [
  'start_ts',
  'elapsed_ms',
  'sql_ms',
  'cpu_ms',
  'fetch_cnt',
  'sql_cnt',
  'ext_ms',
]

const HAS_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/

/** URL 의 from/to — 날짜(YYYY-MM-DD) 또는 ISO 시각(UTC, 예: 산점도 영역 선택) → KST 날짜 + 시각 */
function parseRangeParam(raw: string | null, fallbackDate: string): [string, string] {
  if (!raw) return [fallbackDate, '']
  if (!raw.includes('T')) return [raw, '']
  const d = new Date(HAS_ZONE.test(raw) ? raw : `${raw}Z`)
  if (Number.isNaN(d.getTime())) return [raw, '']
  return [formatKST(d, 'date'), formatKST(d, 'HH:mm:ss')]
}

function filtersFromUrl(sp: URLSearchParams): TxFilters {
  const today = formatKST(new Date(), 'date')
  const [from, fromTime] = parseRangeParam(sp.get('from'), today)
  const [to, toTime] = parseRangeParam(sp.get('to'), today)
  const ids = [...sp.getAll('system'), ...(sp.get('systems') ?? '').split(',')]
  return {
    from,
    fromTime,
    to,
    toTime,
    systemIds: ids
      .filter(Boolean)
      .map(Number)
      .filter((n) => !Number.isNaN(n)),
    role: sp.get('instance') ?? sp.get('role') ?? '',
    uri: sp.get('uri') ?? '',
    userIp: sp.get('user_ip') ?? '',
    userId: sp.get('user_id') ?? '',
    minElapsed: sp.get('min_ms') ?? sp.get('min_elapsed_ms') ?? '',
    maxElapsed: sp.get('max_ms') ?? sp.get('max_elapsed_ms') ?? '',
    minSql: sp.get('min_sql_ms') ?? '',
    errorOnly: sp.get('error_only') === '1',
    traceId: sp.get('trace_id') ?? '',
    spanId: sp.get('span_id') ?? '',
    bizKey: sp.get('biz_key') ?? '',
    minFetch: sp.get('min_fetch_cnt') ?? '',
    minSqlCnt: sp.get('min_sql_cnt') ?? '',
    minConn: sp.get('min_conn_open') ?? '',
  }
}

function sortFromUrl(sp: URLSearchParams): TxSort {
  const by = sp.get('order_by') as TxOrderBy | null
  if (!by || !ORDER_BYS.includes(by)) return DEFAULT_SORT
  return { by, order: sp.get('order') === 'asc' ? 'asc' : 'desc' }
}

const normTime = (t: string) => (t.length === 5 ? `${t}:00` : t)
const kstToUtc = (date: string, time: string) =>
  new Date(`${date}T${normTime(time)}+09:00`).toISOString().replace('.000Z', 'Z')

/** 시각이 있으면 ISO(UTC) 로 직렬화 — 같은 범위는 같은 탭 key 가 된다 */
function filtersToUrl(f: TxFilters): Record<string, string> {
  const entries: [string, string][] = [
    ['from', f.fromTime ? kstToUtc(f.from, f.fromTime) : f.from],
    ['to', f.toTime ? kstToUtc(f.to, f.toTime) : f.to],
    ['systems', f.systemIds.join(',')],
    ['role', f.role.trim()],
    ['uri', f.uri.trim()],
    ['user_ip', f.userIp.trim()],
    ['user_id', f.userId.trim()],
    ['min_elapsed_ms', f.minElapsed],
    ['max_elapsed_ms', f.maxElapsed],
    ['min_sql_ms', f.minSql],
    ['error_only', f.errorOnly ? '1' : ''],
    ['trace_id', f.traceId.trim()],
    ['span_id', f.spanId.trim()],
    ['biz_key', f.bizKey.trim()],
    ['min_fetch_cnt', f.minFetch],
    ['min_sql_cnt', f.minSqlCnt],
    ['min_conn_open', f.minConn],
  ]
  return Object.fromEntries(entries.filter(([, v]) => v !== ''))
}

const RETENTION_FALLBACK = '보관 기간이 지난 데이터입니다'

/** 422(보관일 초과)는 상태 코드만으로 즉시 판정한다. N 은 선택 시스템 보관일, 없으면 detail 메시지에서 추출. */
function useRetentionNotice(error: unknown, retentionDays: number | undefined): string | null {
  const is422 = error instanceof HTTPError && error.response.status === 422
  const [fallback, setFallback] = useState<string | null>(null)
  useEffect(() => {
    if (!is422 || retentionDays) {
      setFallback(null)
      return
    }
    let cancelled = false
    ;(error as HTTPError).response
      .clone()
      .json()
      .then((body: { detail?: unknown }) => {
        const days = (typeof body.detail === 'string' ? body.detail : '').match(/\d+/)?.[0]
        if (!cancelled && days) setFallback(`보관 기간(${days}일) 지난 데이터입니다`)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [error, is422, retentionDays])
  if (!is422) return null
  return retentionDays
    ? `보관 기간(${retentionDays}일) 지난 데이터입니다`
    : (fallback ?? RETENTION_FALLBACK)
}

/** 기간 입력 검증. 문제 없으면 null. */
function validateRange(f: TxFilters): string | null {
  const ok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))
  if (!ok(f.from) || !ok(f.to)) return '시작일과 종료일을 올바르게 입력하세요'
  if (f.from > f.to) return '시작일이 종료일보다 늦을 수 없습니다'
  if (f.from === f.to && f.fromTime && f.toTime && normTime(f.fromTime) > normTime(f.toTime))
    return '시작 시각이 종료 시각보다 늦을 수 없습니다'
  return null
}

const TABS = [
  { key: 'stats', label: '트랜잭션별 통계' },
  { key: 'hourly', label: '트랜잭션 차트' },
  { key: 'tree', label: '콜 트리' },
] as const
type LeftTab = (typeof TABS)[number]['key']

function CountChip({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <span className="bg-bg-deep shadow-neu-inset inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className={cn('font-num font-semibold', tone ?? 'text-text-primary')}>
        {value.toLocaleString()}
      </span>
    </span>
  )
}

/** 목록 보조 열 표시 선택 (사용자별 localStorage) */
function ColumnPicker({
  hidden,
  onChange,
}: {
  hidden: ReadonlySet<string>
  onChange: (col: string, visible: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative ml-auto">
      <NeuButton
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <Columns3 className="mr-1 h-4 w-4" aria-hidden="true" />열 선택
      </NeuButton>
      {open && (
        <div
          role="group"
          aria-label="표시할 열"
          className="bg-bg-base shadow-neu-flat border-border absolute top-full right-0 z-20 mt-1 w-40 rounded-sm border p-2 text-sm"
        >
          {TOGGLEABLE_COLS.map((c) => (
            <label key={c.key} className="hover:bg-hover-subtle flex items-center gap-2 px-1 py-1">
              <input
                type="checkbox"
                checked={!hidden.has(c.key)}
                onChange={(e) => onChange(c.key, e.target.checked)}
              />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function Pager({
  offset,
  total,
  hasMore,
  onGo,
}: {
  offset: number
  total: number | undefined
  hasMore: boolean
  onGo: (offset: number) => void
}) {
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : undefined
  const last = pages !== undefined ? (pages - 1) * PAGE_SIZE : offset
  const btn = 'min-h-[36px] px-2'
  return (
    <nav aria-label="페이지 이동" className="mt-3 flex items-center justify-end gap-1 pr-14">
      <NeuButton
        variant="ghost"
        size="sm"
        className={btn}
        aria-label="첫 페이지"
        disabled={offset === 0}
        onClick={() => onGo(0)}
      >
        <ChevronsLeft className="h-4 w-4" />
      </NeuButton>
      <NeuButton
        variant="ghost"
        size="sm"
        className={btn}
        aria-label="이전"
        disabled={offset === 0}
        onClick={() => onGo(Math.max(0, offset - PAGE_SIZE))}
      >
        <ChevronLeft className="h-4 w-4" />
      </NeuButton>
      <span className="text-text-secondary font-num min-w-[5rem] text-center text-xs">
        {pages !== undefined ? `${page} / ${pages}` : `페이지 ${page}`}
      </span>
      <NeuButton
        variant="ghost"
        size="sm"
        className={btn}
        aria-label="다음"
        disabled={!hasMore}
        onClick={() => onGo(offset + PAGE_SIZE)}
      >
        <ChevronRight className="h-4 w-4" />
      </NeuButton>
      <NeuButton
        variant="ghost"
        size="sm"
        className={btn}
        aria-label="마지막 페이지"
        disabled={pages === undefined || page >= pages}
        onClick={() => onGo(last)}
      >
        <ChevronsRight className="h-4 w-4" />
      </NeuButton>
    </nav>
  )
}

/** 선택한 트랜잭션의 콜 트리 요약 (목록에서 선택 시에만 상세를 조회한다) */
function SelectedCallTree({ tx }: { tx: TxSummary | null }) {
  const { data, isLoading } = useApmTransactionDetail(tx?.trace_id, tx?.span_id)
  if (!tx) return <p className="text-text-secondary text-sm">목록에서 트랜잭션을 선택하세요</p>
  if (isLoading) return <p className="text-text-secondary text-sm">불러오는 중…</p>
  if (!data?.detail)
    return (
      <p className="text-text-secondary text-sm">
        콜 트리는 느린 기준 이상·에러 건만 보관합니다 (선택한 건은 상세가 보존되지 않았습니다)
      </p>
    )
  return (
    <div className="max-h-[360px] overflow-auto">
      <TxCallTreeTab nodes={data.detail.nodes} totalMs={tx.elapsed_ms} />
    </div>
  )
}

export function ApmTransactionsPage() {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const filters = useMemo(() => filtersFromUrl(sp), [sp])
  const sort = useMemo(() => sortFromUrl(sp), [sp])
  const offset = Number(sp.get('offset') ?? 0) || 0
  const { data: systems = [] } = useSystems()
  const user = useAuthStore((s) => s.user)
  const { hidden: hiddenCols, setVisible: setColVisible } = useTxColumns(user?.id)

  // 조회 조건(URL)이 바뀌면 화면 내부 선택·영역·URI 좁히기는 초기화한다
  const spKey = sp.toString()
  const [selected, setSelected] = useState<{ k: string; tx: TxSummary } | null>(null)
  const [brushState, setBrushState] = useState<{ k: string; b: TxBrush } | null>(null)
  const [pick, setPick] = useState<{ k: string; uri: string } | null>(null)
  const [leftTab, setLeftTab] = useState<LeftTab>('stats')
  const brush = brushState?.k === spKey ? brushState.b : null
  const uriPick = pick?.k === spKey ? pick.uri : ''
  const selectedTx = selected?.k === spKey ? selected.tx : null

  const rangeError = validateRange(filters)

  // 정렬·페이징을 제외한 조건 — 목록·통계·시간대 집계가 공유한다
  const filterParams: TxFilterParams = useMemo(() => {
    if (rangeError) return { system_ids: [] }
    const num = (v: string) => (v === '' ? undefined : Number(v))
    return {
      system_ids: filters.systemIds.length ? filters.systemIds : systems.map((s) => s.id),
      start: filters.fromTime
        ? kstToUtc(filters.from, filters.fromTime).replace('Z', '')
        : kstDateToUtcStart(filters.from),
      end: filters.toTime
        ? kstToUtc(filters.to, filters.toTime).replace('Z', '')
        : kstDateToUtcEnd(filters.to),
      instance_role: filters.role || undefined,
      uri: filters.uri || undefined,
      user_ip: filters.userIp || undefined,
      user_id: filters.userId || undefined,
      min_elapsed_ms: num(filters.minElapsed),
      max_elapsed_ms: num(filters.maxElapsed),
      min_sql_ms: num(filters.minSql),
      error_only: filters.errorOnly || undefined,
      trace_id: filters.traceId || undefined,
      span_id: filters.spanId || undefined,
      biz_key: filters.bizKey || undefined,
      min_fetch_cnt: num(filters.minFetch),
      min_sql_cnt: num(filters.minSqlCnt),
      min_conn_open: num(filters.minConn),
    }
  }, [filters, systems, rangeError])

  // URI 좁히기는 목록·시간대 차트에만 적용한다 (통계 표 자체는 전체 URI 를 계속 보여준다)
  const narrowed: TxFilterParams = useMemo(
    () => (uriPick ? { ...filterParams, uri: uriPick } : filterParams),
    [filterParams, uriPick],
  )

  const params: TxListParams = useMemo(
    () => ({
      ...narrowed,
      order_by: sort.by,
      order: sort.order,
      limit: PAGE_SIZE,
      offset,
    }),
    [narrowed, sort, offset],
  )

  const { data, isLoading, error, refetch } = useApmTransactions(params)
  const statsQuery = useApmTxStats({ ...filterParams, limit: STATS_LIMIT }, leftTab === 'stats')
  const hourlyQuery = useApmTxHourly(narrowed, leftTab === 'hourly')
  const selectedSystems = filters.systemIds.length
    ? systems.filter((s) => filters.systemIds.includes(s.id))
    : systems
  const retentionDays =
    Math.max(0, ...selectedSystems.map((s) => s.tx_retention_days ?? 0)) || undefined
  const retentionNotice = useRetentionNotice(error, retentionDays)

  const visibleItems = useMemo(
    () => (data ? (brush ? data.items.filter((t) => inBrush(t, brush)) : data.items) : []),
    [data, brush],
  )

  const systemOptions = systems.map((s) => ({ value: s.id, label: s.display_name }))
  const sortParams = () => {
    const out: Record<string, string> = {}
    for (const k of ['order_by', 'order']) {
      const v = sp.get(k)
      if (v) out[k] = v
    }
    return out
  }
  const goOffset = (next: number) => {
    const copy = new URLSearchParams(sp)
    if (next > 0) copy.set('offset', String(next))
    else copy.delete('offset')
    setSp(copy)
  }
  const onSort = (by: TxOrderBy) => {
    const copy = new URLSearchParams(sp)
    copy.set('order_by', by)
    copy.set('order', by === sort.by && sort.order === 'desc' ? 'asc' : 'desc')
    copy.delete('offset')
    setSp(copy)
  }
  const openTx = (tx: TxSummary) => navigate(ROUTES.apmTx(tx.trace_id, tx.span_id))

  return (
    <div className="pb-16">
      <PageHeader title="트랜잭션 분석" description="기간·조건별 트랜잭션 요약을 조회합니다" />
      <TxFilterBar
        key={spKey}
        value={filters}
        systemOptions={systemOptions}
        onApply={(next) => setSp({ ...filtersToUrl(next), ...sortParams() })}
        validate={validateRange}
      />
      {rangeError ? (
        <NeuCard>
          <p role="alert" className="text-warning-text text-sm">
            {rangeError}
          </p>
        </NeuCard>
      ) : isLoading ? (
        <LoadingSkeleton shape="table" count={8} />
      ) : retentionNotice ? (
        <NeuCard>
          <p role="alert" className="text-warning-text text-sm">
            {retentionNotice}
          </p>
        </NeuCard>
      ) : error ? (
        <ErrorCard message="트랜잭션을 불러오지 못했습니다" onRetry={() => refetch()} />
      ) : !data || (data.items.length === 0 && !uriPick) ? (
        <EmptyState
          icon={<SearchX className="h-12 w-12" />}
          title="조건에 맞는 트랜잭션이 없습니다"
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,9fr)_minmax(0,11fr)]">
          <div className="min-w-0 space-y-4">
            <NeuCard className="p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-text-primary text-sm font-semibold">응답 시간 차트</h2>
                <span className="text-text-tertiary text-xs">
                  현재 페이지 {data.items.length.toLocaleString()}건 · 드래그로 영역 선택
                </span>
              </div>
              <TxScatterChart
                items={data.items}
                selectedKey={selectedTx ? txKey(selectedTx) : null}
                brush={brush}
                onBrush={(b) => setBrushState(b ? { k: spKey, b } : null)}
              />
            </NeuCard>
            <NeuCard className="p-4">
              <div role="tablist" className="mb-3 flex flex-wrap gap-1">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    type="button"
                    aria-selected={leftTab === t.key}
                    onClick={() => setLeftTab(t.key)}
                    className={cn(
                      'focus-visible:ring-accent min-h-[36px] rounded-sm px-3 text-sm focus-visible:ring-1 focus-visible:outline-none',
                      leftTab === t.key
                        ? 'bg-bg-base shadow-neu-inset text-accent font-semibold'
                        : 'text-text-secondary hover:text-text-primary hover:bg-hover-subtle',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {leftTab === 'stats' &&
                (statsQuery.isLoading ? (
                  <p className="text-text-secondary text-sm">집계 중…</p>
                ) : statsQuery.error ? (
                  <p role="alert" className="text-critical-text text-sm">
                    통계를 불러오지 못했습니다
                  </p>
                ) : (
                  <TxStatsTab
                    items={statsQuery.data?.items ?? []}
                    activeUri={uriPick}
                    onPick={(uri) => setPick({ k: spKey, uri })}
                  />
                ))}
              {leftTab === 'hourly' &&
                (hourlyQuery.isLoading ? (
                  <p className="text-text-secondary text-sm">집계 중…</p>
                ) : hourlyQuery.error ? (
                  <p role="alert" className="text-critical-text text-sm">
                    시간대별 추이를 불러오지 못했습니다
                  </p>
                ) : (
                  <TxHourlyChart items={hourlyQuery.data?.items ?? []} />
                ))}
              {leftTab === 'tree' && <SelectedCallTree tx={selectedTx} />}
            </NeuCard>
          </div>

          <NeuCard className="min-w-0 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <CountChip label="전체" value={data.counts?.total ?? data.items.length} />
              <CountChip
                label="정상"
                value={data.counts?.normal ?? data.items.filter((t) => !t.error).length}
                tone="text-normal-text"
              />
              <CountChip
                label="에러"
                value={data.counts?.error ?? data.items.filter((t) => t.error).length}
                tone="text-critical-text"
              />
              {uriPick && (
                <button
                  type="button"
                  onClick={() => setPick(null)}
                  className="bg-bg-deep text-text-secondary hover:text-text-primary inline-flex max-w-[16rem] items-center gap-1 rounded-sm px-2 py-1 text-xs"
                  aria-label="URI 필터 해제"
                >
                  <span className="truncate">URI {uriPick}</span>
                  <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                </button>
              )}
              {brush && (
                <button
                  type="button"
                  onClick={() => setBrushState(null)}
                  className="bg-bg-deep text-text-secondary hover:text-text-primary inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs"
                  aria-label="선택 영역 해제"
                >
                  선택 영역 {visibleItems.length.toLocaleString()}건
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
              <ColumnPicker hidden={hiddenCols} onChange={setColVisible} />
            </div>
            {visibleItems.length === 0 ? (
              <p className="text-text-secondary py-8 text-center text-sm">
                조건에 맞는 트랜잭션이 없습니다
              </p>
            ) : (
              <TxTable
                items={visibleItems}
                sort={sort}
                onSort={onSort}
                selectedKey={selectedTx ? txKey(selectedTx) : null}
                onSelect={(tx) => setSelected({ k: spKey, tx })}
                onOpen={openTx}
                hiddenCols={hiddenCols}
              />
            )}
            <Pager
              offset={offset}
              total={data.counts?.total}
              hasMore={data.has_more}
              onGo={goOffset}
            />
          </NeuCard>
        </div>
      )}
    </div>
  )
}
