import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { HTTPError } from 'ky'
import { SearchX } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorCard } from '@/components/common/ErrorCard'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { TxFilterBar, type TxFilters } from '@/components/apm/TxFilterBar'
import { TxTable } from '@/components/apm/TxTable'
import { useApmTransactions } from '@/hooks/queries/useApmTransactions'
import { useSystems } from '@/hooks/queries/useSystems'
import { formatKST, kstDateToUtcEnd, kstDateToUtcStart } from '@/lib/utils'
import type { TxListParams } from '@/types/apm'

const PAGE_SIZE = 100

function filtersFromUrl(sp: URLSearchParams): TxFilters {
  const today = formatKST(new Date(), 'date')
  return {
    from: sp.get('from') ?? today,
    to: sp.get('to') ?? today,
    systemIds: (sp.get('systems') ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number)
      .filter((n) => !Number.isNaN(n)),
    role: sp.get('role') ?? '',
    uri: sp.get('uri') ?? '',
    userIp: sp.get('user_ip') ?? '',
    userId: sp.get('user_id') ?? '',
    minElapsed: sp.get('min_elapsed_ms') ?? '',
    minSql: sp.get('min_sql_ms') ?? '',
    errorOnly: sp.get('error_only') === '1',
    traceId: sp.get('trace_id') ?? '',
  }
}

function filtersToUrl(f: TxFilters): Record<string, string> {
  const entries: [string, string][] = [
    ['from', f.from],
    ['to', f.to],
    ['systems', f.systemIds.join(',')],
    ['role', f.role.trim()],
    ['uri', f.uri.trim()],
    ['user_ip', f.userIp.trim()],
    ['user_id', f.userId.trim()],
    ['min_elapsed_ms', f.minElapsed],
    ['min_sql_ms', f.minSql],
    ['error_only', f.errorOnly ? '1' : ''],
    ['trace_id', f.traceId.trim()],
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

/** 날짜 입력 검증. 문제 없으면 null. */
function validateRange(from: string, to: string): string | null {
  const ok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))
  if (!ok(from) || !ok(to)) return '시작일과 종료일을 올바르게 입력하세요'
  if (from > to) return '시작일이 종료일보다 늦을 수 없습니다'
  return null
}

export function ApmTransactionsPage() {
  const [sp, setSp] = useSearchParams()
  const filters = useMemo(() => filtersFromUrl(sp), [sp])
  const offset = Number(sp.get('offset') ?? 0) || 0
  const { data: systems = [] } = useSystems()

  const rangeError = validateRange(filters.from, filters.to)

  const params: TxListParams = useMemo(() => {
    if (rangeError) return { system_ids: [] }
    const num = (v: string) => (v === '' ? undefined : Number(v))
    return {
      system_ids: filters.systemIds.length ? filters.systemIds : systems.map((s) => s.id),
      start: kstDateToUtcStart(filters.from),
      end: kstDateToUtcEnd(filters.to),
      instance_role: filters.role || undefined,
      uri: filters.uri || undefined,
      user_ip: filters.userIp || undefined,
      user_id: filters.userId || undefined,
      min_elapsed_ms: num(filters.minElapsed),
      min_sql_ms: num(filters.minSql),
      error_only: filters.errorOnly || undefined,
      trace_id: filters.traceId || undefined,
      limit: PAGE_SIZE,
      offset,
    }
  }, [filters, offset, systems, rangeError])

  const { data, isLoading, error, refetch } = useApmTransactions(params)
  const selected = filters.systemIds.length
    ? systems.filter((s) => filters.systemIds.includes(s.id))
    : systems
  const retentionDays = Math.max(0, ...selected.map((s) => s.tx_retention_days ?? 0)) || undefined
  const retentionNotice = useRetentionNotice(error, retentionDays)

  const systemOptions = systems.map((s) => ({ value: s.id, label: s.display_name }))
  const goOffset = (next: number) => {
    const copy = new URLSearchParams(sp)
    if (next > 0) copy.set('offset', String(next))
    else copy.delete('offset')
    setSp(copy)
  }

  return (
    <div>
      <PageHeader title="트랜잭션 분석" description="기간·조건별 트랜잭션 요약을 조회합니다" />
      <TxFilterBar
        key={sp.toString()}
        value={filters}
        systemOptions={systemOptions}
        onApply={(next) => setSp(filtersToUrl(next))}
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
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<SearchX className="h-12 w-12" />}
          title="조건에 맞는 트랜잭션이 없습니다"
        />
      ) : (
        <NeuCard>
          <TxTable items={data.items} />
          <div className="mt-4 flex items-center justify-end gap-2">
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={offset === 0}
              onClick={() => goOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              이전
            </NeuButton>
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={!data.has_more}
              onClick={() => goOffset(offset + PAGE_SIZE)}
            >
              다음
            </NeuButton>
          </div>
        </NeuCard>
      )}
    </div>
  )
}
