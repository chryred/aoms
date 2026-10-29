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

/** 보관일 초과(422) 응답의 detail 메시지에서 보관일수(N)를 뽑는다. */
function useRetentionNotice(error: unknown): string | null {
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!(error instanceof HTTPError) || error.response.status !== 422) {
      setNotice(null)
      return
    }
    let cancelled = false
    error.response
      .clone()
      .json()
      .then((body: { detail?: unknown }) => {
        const detail = typeof body.detail === 'string' ? body.detail : ''
        const days = detail.match(/\d+/)?.[0]
        if (!cancelled) setNotice(days ? `보관 기간(${days}일) 지난 데이터입니다` : detail)
      })
      .catch(() => {
        if (!cancelled) setNotice('보관 기간이 지난 데이터입니다')
      })
    return () => {
      cancelled = true
    }
  }, [error])
  return notice
}

export function ApmTransactionsPage() {
  const [sp, setSp] = useSearchParams()
  const filters = useMemo(() => filtersFromUrl(sp), [sp])
  const offset = Number(sp.get('offset') ?? 0) || 0
  const { data: systems = [] } = useSystems()

  const params: TxListParams = useMemo(() => {
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
  }, [filters, offset, systems])

  const { data, isLoading, error, refetch } = useApmTransactions(params)
  const retentionNotice = useRetentionNotice(error)

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
      />
      {isLoading ? (
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
