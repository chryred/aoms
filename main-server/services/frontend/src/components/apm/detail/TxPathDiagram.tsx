import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, Database, Monitor, Server } from 'lucide-react'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/lib/utils'
import type { TxSql, TxSummary } from '@/types/apm'

const CARD = 'bg-bg-base border-border rounded-sm border p-3'

const ms = (n: number) => `${Math.round(n).toLocaleString()}ms`
const apOf = (t: TxSummary) => Math.max(0, t.elapsed_ms - t.sql_ms - (t.ext_ms ?? 0))

interface DbNode {
  name: string
  elapsed: number
  exec: number
}

/** 현재 건은 SQL 목록의 db 별로, 그 외 span 은 요약의 SQL 합계로 DB 노드를 만든다 */
function dbNodes(tx: TxSummary, current: boolean, sql: TxSql[]): DbNode[] {
  if (current && sql.length > 0) {
    const m = new Map<string, DbNode>()
    for (const s of sql) {
      const name = s.db || 'DB'
      const n = m.get(name) ?? { name, elapsed: 0, exec: 0 }
      n.elapsed += s.ms
      n.exec += s.cnt
      m.set(name, n)
    }
    return [...m.values()]
  }
  return tx.sql_cnt > 0 ? [{ name: 'DB', elapsed: tx.sql_ms, exec: tx.sql_cnt }] : []
}

function Edge({ label, testId }: { label?: string; testId?: string }) {
  return (
    <div className="text-text-secondary ml-8 flex items-center gap-2 py-1.5" aria-hidden={!label}>
      <ArrowDown className="h-4 w-4 shrink-0" />
      {label && (
        <span
          data-testid={testId}
          className="bg-bg-deep shadow-neu-soft font-num rounded-sm px-2 py-0.5 text-xs"
        >
          {label}
        </span>
      )}
    </div>
  )
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-secondary">{k}</dt>
      <dd className={cn('font-num', strong ? 'text-text-primary font-semibold' : '')}>{v}</dd>
    </div>
  )
}

interface Props {
  current: TxSummary
  path: TxSummary[]
  sql: TxSql[]
  /** 현재 건에 콜 트리(상세)가 있는지 */
  onOpenCallTree: () => void
}

/** 트랜잭션 경로 — 클라이언트 IP → WAS → DB 노드 다이어그램 (분산 호출이면 span 별 WAS 노드가 이어진다) */
export function TxPathDiagram({ current, path, sql, onOpenCallTree }: Props) {
  const navigate = useNavigate()
  const [hideDb, setHideDb] = useState(false)

  const { roots, kids, countOf } = useMemo(() => {
    const spans = path.some((s) => s.span_id === current.span_id) ? path : [current, ...path]
    const ids = new Set(spans.map((s) => s.span_id))
    const byParent = new Map<string, TxSummary[]>()
    const rootList: TxSummary[] = []
    for (const s of [...spans].sort((a, b) => a.start_ts.localeCompare(b.start_ts))) {
      if (s.parent_span && ids.has(s.parent_span) && s.parent_span !== s.span_id) {
        byParent.set(s.parent_span, [...(byParent.get(s.parent_span) ?? []), s])
      } else rootList.push(s)
    }
    const cnt = new Map<string, number>()
    for (const s of spans) {
      const k = `${s.system_id}/${s.instance_role}`
      cnt.set(k, (cnt.get(k) ?? 0) + 1)
    }
    return {
      roots: rootList,
      kids: byParent,
      countOf: (s: TxSummary) => cnt.get(`${s.system_id}/${s.instance_role}`) ?? 1,
    }
  }, [path, current])

  const clientIp = (roots[0] ?? current).user_ip || '-'
  const seen = new Set<string>()

  const renderSpan = (tx: TxSummary, via?: TxSummary) => {
    if (seen.has(tx.span_id)) return null
    seen.add(tx.span_id)
    const isCurrent = tx.span_id === current.span_id
    const dbs = dbNodes(tx, isCurrent, sql)
    const children = kids.get(tx.span_id) ?? []
    const was = (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Server className="text-text-secondary h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {tx.system_name} · {tx.instance_role}
            </span>
          </span>
          {isCurrent && (
            <button
              type="button"
              onClick={onOpenCallTree}
              className="focus-visible:ring-accent rounded-full focus-visible:ring-1 focus-visible:outline-none"
            >
              <NeuBadge variant="info">콜 트리</NeuBadge>
            </button>
          )}
        </div>
        <p className="text-text-secondary mt-1 truncate text-xs" title={tx.uri}>
          {tx.uri}
        </p>
        <dl className="mt-2 space-y-0.5 text-xs">
          <Row k="Elapse" v={ms(tx.elapsed_ms)} strong />
          <Row k="AP" v={ms(apOf(tx))} />
          <Row k="SQL" v={ms(tx.sql_ms)} />
          <Row k="Remote" v={ms(tx.ext_ms ?? 0)} />
          <Row k="Count" v={String(countOf(tx))} />
        </dl>
      </>
    )
    return (
      <div key={tx.span_id} className="flex flex-col items-start">
        {via && (
          <Edge
            label={
              via.ext_cnt > 0
                ? `외부 ${ms(via.ext_ms)} / ${via.ext_cnt}`
                : `원격 ${ms(tx.elapsed_ms)}`
            }
            testId="diagram-remote-edge"
          />
        )}
        {isCurrent ? (
          <div
            data-testid="diagram-was"
            data-current="true"
            className={cn(CARD, 'shadow-neu-pressed w-full max-w-[380px]')}
          >
            {was}
          </div>
        ) : (
          <button
            type="button"
            data-testid="diagram-was"
            title="이 span 의 상세를 새 탭으로 엽니다"
            onClick={() => navigate(ROUTES.apmTx(tx.trace_id, tx.span_id))}
            className={cn(
              CARD,
              'shadow-neu-flat hover:shadow-neu-flat-hover focus-visible:ring-accent w-full max-w-[380px] text-left focus-visible:ring-1 focus-visible:outline-none',
            )}
          >
            {was}
          </button>
        )}
        {!hideDb && dbs.length > 0 && (
          <div className="flex flex-wrap items-start gap-x-6">
            {dbs.map((d) => (
              <div key={d.name} className="flex flex-col items-start">
                <Edge
                  label={`${ms(d.elapsed)} / ${d.exec.toLocaleString()}`}
                  testId="diagram-db-edge"
                />
                <div data-testid="diagram-db" className={cn(CARD, 'shadow-neu-soft min-w-[180px]')}>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Database className="text-text-secondary h-4 w-4" aria-hidden="true" />
                    {d.name}
                  </p>
                  <dl className="mt-2 space-y-0.5 text-xs">
                    <Row k="Elapse" v={ms(d.elapsed)} strong />
                    <Row k="Exec" v={d.exec.toLocaleString()} />
                  </dl>
                </div>
              </div>
            ))}
          </div>
        )}
        {children.map((c) => renderSpan(c, tx))}
      </div>
    )
  }

  return (
    <div>
      <label className="text-text-secondary mb-3 flex w-fit items-center gap-2 text-sm">
        <input type="checkbox" checked={hideDb} onChange={(e) => setHideDb(e.target.checked)} />
        DB 구간 숨김
      </label>
      <div className="flex flex-col items-start" data-testid="path-diagram">
        <div data-testid="diagram-ip" className={cn(CARD, 'shadow-neu-soft')}>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Monitor className="text-text-secondary h-4 w-4" aria-hidden="true" />
            IP {clientIp}
          </p>
        </div>
        {roots.map((r) => (
          <div key={r.span_id} className="flex flex-col items-start">
            <Edge />
            {renderSpan(r)}
          </div>
        ))}
      </div>
    </div>
  )
}
