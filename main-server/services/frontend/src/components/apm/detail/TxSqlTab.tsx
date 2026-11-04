import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { statementType, summarizeSql } from '@/lib/apm/sqlFormat'
import type { SqlStatementType } from '@/lib/apm/sqlFormat'
import type { TxSql } from '@/types/apm'
import { SqlViewer } from './SqlViewer'

type SortKey = 'ms' | 'cnt' | 'avg_ms' | 'max_ms' | 'fetch_cnt' | 'fetch_ms' | 'err'

const avgOf = (s: TxSql) => (s.cnt > 0 ? s.ms / s.cnt : 0)
const valueOf = (s: TxSql, k: SortKey) => (k === 'avg_ms' ? avgOf(s) : s[k])

/** hideBelow: 이 화면 폭 미만에서는 열을 숨긴다 (md 768px, lg 1024px) */
const COLS: { key: SortKey; label: string; hideBelow?: 'md' | 'lg' }[] = [
  { key: 'cnt', label: '실행 횟수' },
  { key: 'ms', label: '시간(ms)' },
  { key: 'avg_ms', label: '평균(ms)', hideBelow: 'md' },
  { key: 'max_ms', label: '최대(ms)', hideBelow: 'lg' },
  { key: 'fetch_cnt', label: 'fetch 건수', hideBelow: 'md' },
  { key: 'fetch_ms', label: 'fetch(ms)', hideBelow: 'lg' },
  { key: 'err', label: '에러' },
]

const HIDE = { md: 'hidden @min-[520px]:block', lg: 'hidden @min-[860px]:block' } as const

/** SQL | 횟수 | 시간 | 시간 막대 | [최대] | [fetch 건수] | [fetch ms] | 에러 : 좁은 폭에서는 부가 열을 접어 고정 최소 폭 없이 맞춘다 */
const GRID = cn(
  'grid items-center gap-x-2 px-3 @min-[520px]:gap-x-3',
  'grid-cols-[minmax(0,1fr)_44px_64px_36px]',
  '@min-[520px]:grid-cols-[minmax(0,1fr)_52px_72px_56px_64px_76px_44px]',
  '@min-[860px]:grid-cols-[minmax(0,1fr)_56px_72px_64px_64px_72px_76px_80px_48px]',
)

const TYPE_CLASS: Record<SqlStatementType, string> = {
  SELECT: 'text-sql-keyword',
  INSERT: 'text-normal-text',
  UPDATE: 'text-warning-text',
  DELETE: 'text-critical-text',
  MERGE: 'text-warning-text',
  CALL: 'text-sql-function',
  OTHER: 'text-text-secondary',
}

const num = 'text-right tabular-nums'

/** focusId: 콜 트리에서 넘어온 SQL — 처음부터 펼치고 화면에 보이게 한다 */
export function TxSqlTab({ sql, focusId }: { sql: TxSql[]; focusId?: string }) {
  const [sortKey, setSortKey] = useState<SortKey>('ms')
  const [sortDesc, setSortDesc] = useState(true)

  const rows = useMemo(() => {
    const sorted = [...sql].sort((a, b) =>
      sortDesc
        ? valueOf(b, sortKey) - valueOf(a, sortKey)
        : valueOf(a, sortKey) - valueOf(b, sortKey),
    )
    return sorted
  }, [sql, sortKey, sortDesc])

  // 가장 느린(시간 합계 최대) SQL 은 처음부터 펼친다
  const [open, setOpen] = useState<Set<string>>(() => {
    const focus = focusId ? sql.find((s) => s.sql_id === focusId) : undefined
    const slowest = focus ?? [...sql].sort((a, b) => b.ms - a.ms)[0]
    return new Set(slowest ? [slowest.sql_id] : [])
  })

  useEffect(() => {
    if (!focusId) return
    document.getElementById(`sql-row-${focusId}`)?.scrollIntoView?.({ block: 'center' })
  }, [focusId])

  if (sql.length === 0) return <p className="text-text-secondary text-sm">실행된 SQL이 없습니다</p>

  const maxMs = Math.max(1, ...sql.map((s) => s.ms))
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const sortBy = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  return (
    <div className="@container min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-text-secondary">정렬</span>
        {(
          [
            ['ms', '오래 걸린 순'],
            ['cnt', '실행 많은 순'],
          ] as const
        ).map(([k, label]) => {
          const on = sortKey === k && sortDesc
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setSortKey(k)
                setSortDesc(true)
              }}
              className={cn(
                'min-h-[28px] rounded-sm px-2.5',
                on
                  ? 'bg-bg-base shadow-neu-pressed text-text-primary font-semibold'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div>
        <div className={cn(GRID, 'border-border text-text-secondary border-b py-2 text-xs')}>
          <span className="font-medium">SQL {sql.length}건</span>
          {COLS.map((c) => {
            const active = c.key === sortKey
            return (
              <Fragment key={c.key}>
                <span className={cn('text-right', c.hideBelow && HIDE[c.hideBelow])}>
                  <button
                    type="button"
                    onClick={() => sortBy(c.key)}
                    className={cn(
                      'focus-visible:ring-accent rounded-sm font-medium whitespace-nowrap focus-visible:ring-1 focus-visible:outline-none',
                      active ? 'text-text-primary' : 'hover:text-text-primary',
                    )}
                  >
                    {c.label}
                    {active && <span aria-hidden="true">{sortDesc ? ' ↓' : ' ↑'}</span>}
                  </button>
                </span>
                {c.key === 'ms' && <span aria-hidden="true" className={HIDE.md} />}
              </Fragment>
            )
          })}
        </div>
        <ul>
          {rows.map((s) => {
            const expanded = open.has(s.sql_id)
            const type = statementType(s.sql_text)
            const panelId = `sql-panel-${s.sql_id}`
            return (
              <li
                key={s.sql_id}
                id={`sql-row-${s.sql_id}`}
                className="border-border border-b"
                data-testid="sql-row"
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => toggle(s.sql_id)}
                  className={cn(
                    GRID,
                    'hover:bg-hover-subtle focus-visible:ring-accent w-full py-2 text-left text-sm focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset',
                  )}
                >
                  <span className="min-w-0 overflow-hidden">
                    <span className="flex min-w-0 items-center gap-2">
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          'text-text-secondary h-3.5 w-3.5 shrink-0 transition-transform',
                          expanded && 'rotate-90',
                        )}
                      />
                      <span
                        className={cn(
                          'w-14 shrink-0 font-mono text-xs font-semibold',
                          TYPE_CLASS[type],
                        )}
                      >
                        {type === 'OTHER' ? '기타' : type}
                      </span>
                      <span className="text-text-primary min-w-[12ch] flex-1 truncate font-mono text-xs">
                        {summarizeSql(s.sql_text)}
                      </span>
                      {s.db && (
                        <span
                          title={`DB ${s.db}`}
                          className="text-text-tertiary bg-muted-bg hidden max-w-[10rem] min-w-0 shrink truncate rounded-sm px-1.5 text-[0.6875rem] @min-[860px]:inline-block"
                        >
                          {s.db}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className={num}>{s.cnt.toLocaleString()}</span>
                  <span className={cn(num, 'font-medium')}>{s.ms.toLocaleString()}</span>
                  <span aria-hidden="true" className={cn('bg-muted-bg h-1.5 rounded-sm', HIDE.md)}>
                    <span
                      data-testid="sql-time-bar"
                      className="bg-text-tertiary block h-full rounded-sm"
                      style={{ width: s.ms > 0 ? `${Math.max(8, (s.ms / maxMs) * 100)}%` : 0 }}
                    />
                  </span>
                  <span className={cn(num, HIDE.md)}>{Math.round(avgOf(s)).toLocaleString()}</span>
                  <span className={cn(num, HIDE.lg)}>{s.max_ms.toLocaleString()}</span>
                  <span className={cn(num, HIDE.md)}>{s.fetch_cnt.toLocaleString()}</span>
                  <span className={cn(num, HIDE.lg)}>{s.fetch_ms.toLocaleString()}</span>
                  <span
                    className={cn(
                      num,
                      s.err ? 'text-critical-text font-semibold' : 'text-text-disabled',
                    )}
                  >
                    {s.err || '-'}
                  </span>
                </button>
                {expanded && (
                  <div id={panelId} className="min-w-0 px-3 pt-1 pb-3">
                    <SqlViewer sql={s.sql_text} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
