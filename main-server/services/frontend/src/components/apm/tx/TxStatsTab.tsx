import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { TxUriStat } from '@/types/apm'

type SortKey =
  | 'uri'
  | 'ratio'
  | 'count'
  | 'error_count'
  | 'elapsed_max'
  | 'elapsed_avg'
  | 'sql_max'
  | 'sql_avg'
  | 'ext_avg'
  | 'ap_avg'

const COLS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: 'uri', label: '트랜잭션(URI)' },
  { key: 'ratio', label: '비율' },
  { key: 'count', label: '건수', right: true },
  { key: 'error_count', label: '에러', right: true },
  { key: 'elapsed_max', label: '응답 최대', right: true },
  { key: 'elapsed_avg', label: '응답 평균', right: true },
  { key: 'sql_max', label: 'SQL 최대', right: true },
  { key: 'sql_avg', label: 'SQL 평균', right: true },
  { key: 'ext_avg', label: '외부 평균', right: true },
  { key: 'ap_avg', label: 'AP 평균', right: true },
]

const fmt = (n: number) => Math.round(n).toLocaleString()

interface Props {
  items: TxUriStat[]
  activeUri: string
  onPick: (uri: string) => void
}

export function TxStatsTab({ items, activeUri, onPick }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('count')
  const [desc, setDesc] = useState(true)
  const rows = useMemo(() => {
    const s = [...items].sort((a, b) =>
      sortKey === 'uri' ? a.uri.localeCompare(b.uri) : a[sortKey] - b[sortKey],
    )
    return desc ? s.reverse() : s
  }, [items, sortKey, desc])

  if (items.length === 0)
    return <p className="text-text-secondary text-sm">집계할 트랜잭션이 없습니다</p>

  const sortBy = (k: SortKey) => {
    if (k === sortKey) setDesc((d) => !d)
    else {
      setSortKey(k)
      setDesc(k !== 'uri')
    }
  }

  return (
    <div className="max-h-[360px] overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="bg-bg-base sticky top-0 z-10">
          <tr className="border-border text-text-secondary border-b">
            {COLS.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={c.key === sortKey ? (desc ? 'descending' : 'ascending') : undefined}
                className={cn('px-2 py-1.5 font-medium whitespace-nowrap', c.right && 'text-right')}
              >
                <button
                  type="button"
                  onClick={() => sortBy(c.key)}
                  className={cn(
                    'focus-visible:ring-accent rounded-sm font-medium focus-visible:ring-1 focus-visible:outline-none',
                    c.key === sortKey ? 'text-text-primary' : 'hover:text-text-primary',
                  )}
                >
                  {c.label}
                  {c.key === sortKey && <span aria-hidden="true">{desc ? ' ↓' : ' ↑'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length > 0 &&
            rows.map((r) => {
              const pct = Math.min(100, Math.max(0, r.ratio))
              // 막대 안에서 SQL/AP 비중 (평균 응답 대비)
              const sqlShare = r.elapsed_avg > 0 ? Math.min(1, r.sql_avg / r.elapsed_avg) : 0
              const active = r.uri === activeUri
              return (
                <tr
                  key={r.uri}
                  data-testid="stats-row"
                  tabIndex={0}
                  aria-selected={active}
                  onClick={() => onPick(active ? '' : r.uri)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onPick(active ? '' : r.uri)
                    }
                  }}
                  className={cn(
                    'border-border hover:bg-hover-subtle focus-visible:ring-accent cursor-pointer border-b focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset',
                    active && 'bg-bg-deep shadow-neu-pressed',
                  )}
                >
                  <td className="max-w-[180px] truncate px-2 py-1.5" title={r.uri}>
                    {r.uri}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="bg-bg-deep h-2 w-16 shrink-0 overflow-hidden rounded-sm"
                        aria-hidden="true"
                      >
                        <div className="flex h-full" style={{ width: `${pct}%` }}>
                          <span
                            className="h-full"
                            style={{
                              width: `${(1 - sqlShare) * 100}%`,
                              background: 'var(--t-series-1)',
                            }}
                          />
                          <span
                            className="h-full"
                            style={{ width: `${sqlShare * 100}%`, background: 'var(--t-series-2)' }}
                          />
                        </div>
                      </div>
                      <span className="font-num text-text-secondary">{pct.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="font-num px-2 py-1.5 text-right">{r.count.toLocaleString()}</td>
                  <td
                    className={cn(
                      'font-num px-2 py-1.5 text-right',
                      r.error_count > 0 ? 'text-critical-text font-semibold' : 'text-text-disabled',
                    )}
                  >
                    {r.error_count || '-'}
                  </td>
                  <td className="font-num px-2 py-1.5 text-right">{fmt(r.elapsed_max)}</td>
                  <td className="font-num px-2 py-1.5 text-right">{fmt(r.elapsed_avg)}</td>
                  <td className="font-num px-2 py-1.5 text-right">{fmt(r.sql_max)}</td>
                  <td className="font-num px-2 py-1.5 text-right">{fmt(r.sql_avg)}</td>
                  <td className="font-num px-2 py-1.5 text-right">{fmt(r.ext_avg)}</td>
                  <td className="font-num px-2 py-1.5 text-right">{fmt(r.ap_avg)}</td>
                </tr>
              )
            })}
        </tbody>
      </table>
      <p className="text-text-tertiary mt-2 flex items-center gap-3 text-xs">
        <span className="inline-flex items-center gap-1">
          <i
            className="inline-block h-2 w-2 rounded-xs"
            style={{ background: 'var(--t-series-1)' }}
          />
          AP
        </span>
        <span className="inline-flex items-center gap-1">
          <i
            className="inline-block h-2 w-2 rounded-xs"
            style={{ background: 'var(--t-series-2)' }}
          />
          SQL
        </span>
        <span>단위 ms · 행 클릭 시 해당 URI 로 목록을 좁힙니다</span>
      </p>
    </div>
  )
}
