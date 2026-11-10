import { useEffect, useMemo, useRef, useState } from 'react'
import { useTabTitle } from '@/components/layout/tabs/TabContext'
import { useRegisterScreenContext } from '@/store/chatContextStore'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Info } from 'lucide-react'
import { ErrorCard } from '@/components/common/ErrorCard'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { TxPathTab } from '@/components/apm/detail/TxPathTab'
import { TxPathDiagram } from '@/components/apm/detail/TxPathDiagram'
import { TxSqlTab } from '@/components/apm/detail/TxSqlTab'
import { TxCallTreeTab } from '@/components/apm/detail/TxCallTreeTab'
import { TxStackTab } from '@/components/apm/detail/TxStackTab'
import { TxMethodStatsTab } from '@/components/apm/detail/TxMethodStatsTab'
import { TxParamsTab } from '@/components/apm/detail/TxParamsTab'
import { TxResourceTab } from '@/components/apm/detail/TxResourceTab'
import { TxExceptionTab } from '@/components/apm/detail/TxExceptionTab'
import { exceptionCount } from '@/lib/apm/txUtils'
import { ROUTES } from '@/constants/routes'
import { useSystems } from '@/hooks/queries/useSystems'
import { useApmTransactionDetail } from '@/hooks/queries/useApmTransactionDetail'
import { cn, formatKST } from '@/lib/utils'

const MENU = [
  { key: 'path', label: '트랜잭션 경로' },
  { key: 'sql', label: 'SQL 목록' },
  { key: 'exception', label: '예외(에러)' },
  { key: 'method', label: '메소드 통계' },
  { key: 'params', label: '사용자 전문' },
  { key: 'tree', label: '콜 트리' },
  { key: 'stack', label: '액티브 내역(스택 샘플)' },
  { key: 'resource', label: '리소스' },
] as const
type MenuKey = (typeof MENU)[number]['key']

const DEFAULT_SLOW_SEC = 3

export function ApmTxDetailPage() {
  const { traceId, spanId } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<MenuKey>('path')
  const [infoOpen, setInfoOpen] = useState(false)
  const [focusSql, setFocusSql] = useState<string | undefined>()
  const infoRef = useRef<HTMLDivElement>(null)
  const { data, isLoading, error, refetch } = useApmTransactionDetail(traceId, spanId)
  const { data: systems = [] } = useSystems()
  useTabTitle(data?.summary.uri)
  // 챗봇에 이 트랜잭션의 시스템을 알린다 (trace_id/span_id 는 경로에서 도출)
  useRegisterScreenContext({
    system_id: data?.summary.system_id != null ? String(data.summary.system_id) : undefined,
  })

  useEffect(() => {
    if (!infoOpen) return
    const onDown = (e: MouseEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setInfoOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setInfoOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [infoOpen])

  const dbNames = useMemo(
    () => [...new Set((data?.sql ?? []).map((s) => s.db).filter((d): d is string => !!d))],
    [data?.sql],
  )

  const back = (
    <NeuButton variant="ghost" size="sm" onClick={() => navigate(ROUTES.APM_TRANSACTIONS)}>
      <ArrowLeft className="h-4 w-4" /> 목록
    </NeuButton>
  )

  if (isLoading) return <LoadingSkeleton shape="table" count={6} />
  if (error || !data) {
    return (
      <div>
        <PageHeader title="트랜잭션 상세" action={back} />
        <ErrorCard message="트랜잭션을 불러오지 못했습니다" onRetry={() => refetch()} />
      </div>
    )
  }
  const { summary, sql, detail, path, params } = data
  const slowMs = systems.find((s) => s.id === summary.system_id)?.tx_slow_threshold_ms
  const NO_DETAIL = `호출 트리는 느린 기준(${slowMs ? slowMs / 1000 : DEFAULT_SLOW_SEC}초) 이상·에러 건만 보관합니다`
  const excCount = exceptionCount(summary, sql)

  const jumpToSql = (sqlId: string) => {
    setFocusSql(sqlId)
    setTab('sql')
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="type-heading text-text-primary text-2xl font-bold break-all">
            {summary.uri}
          </h1>
          <p className="text-text-secondary font-num mt-1.5 text-sm">
            {summary.system_name} · {summary.instance_role} · 시작{' '}
            {formatKST(summary.start_ts, 'HH:mm:ss.SSS')} · {summary.elapsed_ms.toLocaleString()}ms
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <NeuBadge variant={summary.error ? 'critical' : 'normal'}>
              {summary.method} {summary.status}
            </NeuBadge>
            {summary.error ? <NeuBadge variant="critical">에러</NeuBadge> : null}
            {summary.exc_class && <NeuBadge variant="critical">{summary.exc_class}</NeuBadge>}
            <NeuBadge>IP {summary.user_ip || '-'}</NeuBadge>
            <NeuBadge>ID {summary.user_id || '-'}</NeuBadge>
            {summary.biz_key && <NeuBadge>거래키 {summary.biz_key}</NeuBadge>}
            <div ref={infoRef} className="relative">
              <button
                type="button"
                aria-expanded={infoOpen}
                aria-haspopup="dialog"
                onClick={() => setInfoOpen((o) => !o)}
                className="text-text-secondary hover:text-text-primary hover:bg-hover-subtle focus-visible:ring-accent inline-flex min-h-[28px] items-center gap-1 rounded-sm px-2 text-xs focus-visible:ring-1 focus-visible:outline-none"
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                상세 정보
              </button>
              {infoOpen && (
                <div
                  role="dialog"
                  aria-label="트랜잭션 상세 정보"
                  className="bg-bg-base shadow-neu-flat border-border absolute top-full left-0 z-20 mt-1 w-[min(92vw,420px)] rounded-sm border p-3 text-sm"
                >
                  <dl className="grid grid-cols-[4rem_1fr] gap-y-2">
                    <dt className="text-text-secondary text-xs font-medium">AGENT</dt>
                    <dd className="break-all">
                      {summary.system_name} / {summary.instance_role}
                      <span className="text-text-secondary block text-xs">
                        호스트 {summary.host || '-'}
                      </span>
                    </dd>
                    <dt className="text-text-secondary text-xs font-medium">DB</dt>
                    <dd className="break-all">{dbNames.length ? dbNames.join(', ') : '-'}</dd>
                    <dt className="text-text-secondary text-xs font-medium">TID</dt>
                    <dd className="font-num break-all">
                      {summary.span_id}
                      <span className="text-text-secondary block text-xs">
                        trace {summary.trace_id}
                      </span>
                    </dd>
                  </dl>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="shrink-0">{back}</div>
      </div>

      <div className="md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:items-start md:gap-4">
        <div
          role="tablist"
          aria-orientation="vertical"
          className="mb-4 flex gap-1 overflow-x-auto md:sticky md:top-2 md:mb-0 md:flex-col md:overflow-visible"
        >
          {MENU.map((m) => (
            <button
              key={m.key}
              role="tab"
              type="button"
              aria-selected={tab === m.key}
              onClick={() => setTab(m.key)}
              className={cn(
                'focus-visible:ring-accent flex min-h-[40px] shrink-0 items-center justify-between gap-2 rounded-sm px-4 text-left text-sm whitespace-nowrap focus-visible:ring-1 focus-visible:outline-none',
                tab === m.key
                  ? 'bg-bg-base shadow-neu-inset text-accent font-semibold'
                  : 'text-text-secondary hover:text-text-primary hover:bg-hover-subtle',
              )}
            >
              {m.label}
              {m.key === 'exception' && (
                <span
                  className={cn(
                    'font-num text-xs',
                    excCount > 0 ? 'text-critical-text font-semibold' : 'text-text-disabled',
                  )}
                >
                  ({excCount})
                </span>
              )}
            </button>
          ))}
        </div>
        <NeuCard className="min-w-0">
          {tab === 'path' && (
            <div className="space-y-6">
              <TxPathDiagram
                current={summary}
                path={path}
                sql={sql}
                onOpenCallTree={() => setTab('tree')}
              />
              <div>
                <h2 className="text-text-secondary mb-2 text-sm font-semibold">시간축</h2>
                <TxPathTab path={path} current={summary} />
              </div>
            </div>
          )}
          {tab === 'sql' && <TxSqlTab sql={sql} focusId={focusSql} />}
          {tab === 'exception' && <TxExceptionTab summary={summary} sql={sql} />}
          {tab === 'method' && <TxMethodStatsTab stacks={detail?.stacks ?? []} summary={summary} />}
          {tab === 'params' && <TxParamsTab params={params} />}
          {tab === 'tree' &&
            (detail ? (
              <TxCallTreeTab
                nodes={detail.nodes}
                totalMs={summary.elapsed_ms}
                onJumpSql={jumpToSql}
              />
            ) : (
              <p className="text-text-secondary text-sm">{NO_DETAIL}</p>
            ))}
          {tab === 'stack' &&
            (detail ? (
              <TxStackTab
                stacks={detail.stacks}
                unmeasuredMs={Math.max(0, summary.elapsed_ms - summary.sql_ms - summary.ext_ms)}
                onOpenMethodStats={() => setTab('method')}
              />
            ) : (
              <p className="text-text-secondary text-sm">{NO_DETAIL}</p>
            ))}
          {tab === 'resource' && <TxResourceTab summary={summary} />}
        </NeuCard>
      </div>
    </div>
  )
}
