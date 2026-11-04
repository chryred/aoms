import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { apMs, txKey } from '@/lib/apm/txUtils'
import { cn, formatKST, normalizeUtc } from '@/lib/utils'
import type { TxOrderBy, TxSummary } from '@/types/apm'

export interface TxSort {
  by: TxOrderBy
  order: 'asc' | 'desc'
}

interface Col {
  key: string
  label: string
  sort?: TxOrderBy
  align?: 'right'
}

const COLS: Col[] = [
  { key: 'end', label: '시간(종료)' },
  { key: 'sys', label: '시스템·인스턴스' },
  { key: 'uri', label: '트랜잭션(URI)' },
  { key: 'start', label: '시작 시각', sort: 'start_ts' },
  { key: 'elapsed', label: '수행 시간(ms)', sort: 'elapsed_ms', align: 'right' },
  { key: 'ap', label: 'AP(ms)', align: 'right' },
  { key: 'cpu', label: 'CPU(ms)', sort: 'cpu_ms', align: 'right' },
  { key: 'sql', label: 'SQL(ms)', sort: 'sql_ms', align: 'right' },
  { key: 'sqlcnt', label: 'SQL 건수', sort: 'sql_cnt', align: 'right' },
  { key: 'fetch', label: 'fetch', sort: 'fetch_cnt', align: 'right' },
  { key: 'ext', label: '외부(ms)', sort: 'ext_ms', align: 'right' },
  { key: 'ip', label: 'IP' },
  { key: 'user', label: '사용자' },
  { key: 'host', label: '호스트' },
]

const endTime = (tx: TxSummary) =>
  formatKST(new Date(Date.parse(normalizeUtc(tx.start_ts)) + tx.elapsed_ms), 'HH:mm:ss.SSS')

interface Props {
  items: TxSummary[]
  sort: TxSort
  onSort: (by: TxOrderBy) => void
  selectedKey: string | null
  onSelect: (tx: TxSummary) => void
  /** 더블클릭 또는 Enter — 상세를 새 탭으로 연다 */
  onOpen: (tx: TxSummary) => void
  /** 숨길 열 키 (TOGGLEABLE_COLS) */
  hiddenCols?: ReadonlySet<string>
}

export function TxTable({ items, sort, onSort, selectedKey, onSelect, onOpen, hiddenCols }: Props) {
  const cols = COLS.filter((c) => !hiddenCols?.has(c.key))
  const show = (k: string) => !hiddenCols?.has(k)
  return (
    <div className="max-h-[640px] overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-bg-base sticky top-0 z-10">
          <tr className="border-border text-text-secondary border-b text-xs">
            {cols.map((c) => {
              const active = c.sort && c.sort === sort.by
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    active ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={cn(
                    'px-2.5 py-2 font-medium whitespace-nowrap',
                    c.align === 'right' && 'text-right',
                  )}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.sort!)}
                      className={cn(
                        'focus-visible:ring-accent rounded-sm font-medium focus-visible:ring-1 focus-visible:outline-none',
                        active ? 'text-text-primary' : 'hover:text-text-primary',
                      )}
                    >
                      {c.label}
                      {active && (
                        <span aria-hidden="true">{sort.order === 'asc' ? ' ↑' : ' ↓'}</span>
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {items.map((tx) => {
            const key = txKey(tx)
            const selected = key === selectedKey
            return (
              <tr
                key={key}
                tabIndex={0}
                aria-selected={selected}
                data-testid="tx-row"
                onClick={() => onSelect(tx)}
                onDoubleClick={() => onOpen(tx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(tx)
                  else if (e.key === ' ') {
                    e.preventDefault()
                    onSelect(tx)
                  }
                }}
                className={cn(
                  'border-border hover:bg-hover-subtle focus-visible:ring-accent cursor-pointer border-b focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset',
                  selected && 'bg-bg-deep shadow-neu-pressed',
                )}
              >
                <td className="font-num px-2.5 py-1.5 whitespace-nowrap">{endTime(tx)}</td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  {tx.system_name} · {tx.instance_role}
                </td>
                <td className="max-w-[260px] truncate px-2.5 py-1.5" title={tx.uri}>
                  {tx.uri}
                </td>
                <td className="font-num px-2.5 py-1.5 whitespace-nowrap">
                  {formatKST(tx.start_ts, 'HH:mm:ss.SSS')}
                </td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="inline-flex w-9 shrink-0 justify-center">
                      {tx.error ? <NeuBadge variant="critical">에러</NeuBadge> : null}
                    </span>
                    <span className="font-num inline-block min-w-[3.25rem] text-right tabular-nums">
                      {tx.elapsed_ms.toLocaleString()}
                    </span>
                  </div>
                </td>
                <td className="font-num px-2.5 py-1.5 text-right">{apMs(tx).toLocaleString()}</td>
                <td className="font-num px-2.5 py-1.5 text-right">{tx.cpu_ms.toLocaleString()}</td>
                <td className="font-num px-2.5 py-1.5 text-right">{tx.sql_ms.toLocaleString()}</td>
                <td className="font-num px-2.5 py-1.5 text-right">{tx.sql_cnt.toLocaleString()}</td>
                {show('fetch') && (
                  <td className="font-num px-2.5 py-1.5 text-right whitespace-nowrap">
                    {(tx.fetch_cnt ?? 0).toLocaleString()}
                  </td>
                )}
                {show('ext') && (
                  <td className="font-num px-2.5 py-1.5 text-right">
                    {(tx.ext_ms ?? 0).toLocaleString()}
                  </td>
                )}
                <td className="px-2.5 py-1.5 whitespace-nowrap">{tx.user_ip}</td>
                {show('user') && <td className="px-2.5 py-1.5 whitespace-nowrap">{tx.user_id}</td>}
                {show('host') && (
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{tx.host || '-'}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
