import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { buildCallTree } from '@/lib/apm/callTree'
import type { CallTreeRow } from '@/lib/apm/callTree'
import { barRange, timeTicks } from '@/lib/apm/timeScale'
import { cn } from '@/lib/utils'
import type { TxNode } from '@/types/apm'

/** 종류별 막대 색 — 채도를 낮춘 토큰만 사용 (SQL=차분한 블루, EXT=사선 무늬(AP 회색과 구분), 나머지 중립) */
const KIND_BAR: Record<string, string> = {
  http: 'bg-text-tertiary',
  sql: 'bg-apm-normal',
  ext: 'apm-seg-remote',
  gap: 'bg-text-disabled/40',
}

/** 느린 구간 강조 기준 (전체 대비 비율) */
const SLOW_RATIO = 0.3

/** 라벨 | 수행시간 | 비율 | [타임라인] — 좁으면 타임라인 열을 접고 막대를 라벨 아래 얇게 둔다 */
const GRID = cn(
  'grid items-center gap-x-3',
  'grid-cols-[minmax(0,1fr)_64px_52px]',
  '@min-[720px]:grid-cols-[minmax(0,1fr)_72px_56px_minmax(0,40%)]',
)

const KIND_BADGE: Record<string, { label: string; variant: 'muted' | 'normal' | 'warning' }> = {
  http: { label: 'HTTP', variant: 'muted' },
  sql: { label: 'SQL', variant: 'normal' },
  ext: { label: 'EXT', variant: 'warning' },
}

interface Props {
  nodes: TxNode[]
  totalMs: number
  /** SQL 노드를 눌렀을 때 — SQL 목록의 해당 SQL 로 이동 */
  onJumpSql?: (sqlId: string) => void
}

export function TxCallTreeTab({ nodes, totalMs, onJumpSql }: Props) {
  const rows = useMemo(() => buildCallTree(nodes, totalMs), [nodes, totalMs])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [minPct, setMinPct] = useState('0')

  const hasKids = (i: number) => i + 1 < rows.length && rows[i + 1].depth > rows[i].depth
  const ticks = useMemo(() => timeTicks(totalMs), [totalMs])
  const threshold = Math.max(0, Number(minPct) || 0)

  const visible = useMemo(() => {
    const out: { row: CallTreeRow; expandable: boolean }[] = []
    let skipDepth: number | null = null
    rows.forEach((row, i) => {
      if (skipDepth !== null) {
        if (row.depth > skipDepth) return
        skipDepth = null
      }
      if (row.depth > 0 && threshold > 0 && row.ratio * 100 <= threshold) {
        skipDepth = row.depth
        return
      }
      out.push({ row, expandable: i + 1 < rows.length && rows[i + 1].depth > row.depth })
      if (collapsed.has(row.id)) skipDepth = row.depth
    })
    return out
  }, [rows, collapsed, threshold])

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const collapseAll = () =>
    setCollapsed(new Set(rows.filter((_, i) => hasKids(i)).map((r) => r.id)))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="text-text-secondary flex items-center gap-1.5">
          수행 시간
          <input
            type="number"
            min={0}
            max={100}
            aria-label="숨길 수행 시간 비율(%)"
            value={minPct}
            onChange={(e) => setMinPct(e.target.value)}
            className="bg-bg-base border-border shadow-neu-inset text-text-primary focus:ring-accent w-16 rounded-sm border px-2 py-1 text-right text-xs focus:ring-1 focus:outline-none"
          />
          % 이하 숨기기
        </label>
        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          className="text-text-secondary hover:text-text-primary hover:bg-hover-subtle rounded-sm px-2 py-1"
        >
          모두 펼치기
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className="text-text-secondary hover:text-text-primary hover:bg-hover-subtle rounded-sm px-2 py-1"
        >
          모두 접기
        </button>
        <span className="text-text-tertiary ml-auto">
          {visible.length}/{rows.length}행
        </span>
      </div>
      <div className="@container min-w-0">
        <div
          role="row"
          className={cn(GRID, 'border-border text-text-tertiary border-b px-2 pb-1 text-xs')}
        >
          <span>호출</span>
          <span className="text-right">수행(ms)</span>
          <span className="text-right">비율</span>
          <div
            className="relative col-span-3 mt-1 h-4 @min-[720px]:col-span-1 @min-[720px]:mt-0"
            aria-hidden="true"
          >
            {ticks.map((t) => (
              <span
                key={t.frac}
                data-testid="tick-label"
                className={cn(
                  'font-num absolute top-0 tabular-nums',
                  t.frac % 0.5 !== 0 && 'hidden @min-[720px]:block',
                )}
                style={{
                  left: `${t.frac * 100}%`,
                  transform: `translateX(-${t.frac * 100}%)`,
                }}
              >
                {t.ms.toLocaleString()}
              </span>
            ))}
          </div>
        </div>
        <ul data-testid="call-tree">
          {visible.map(({ row: r, expandable }) => {
            const badge = KIND_BADGE[r.kind]
            const jump = r.kind === 'sql' && r.sqlId && onJumpSql
            const isCollapsed = collapsed.has(r.id)
            const slow = r.depth > 0 && r.kind !== 'gap' && r.ratio >= SLOW_RATIO
            const { left, width } = barRange(r.startMs, r.durMs, totalMs)
            const bar = (
              <span
                data-testid="call-bar"
                data-slow={slow ? 'true' : undefined}
                className={cn(
                  'absolute top-1/2 h-1.5 min-w-[2px] -translate-y-1/2 rounded-sm opacity-80 group-hover:opacity-100',
                  slow ? 'bg-apm-warning' : KIND_BAR[r.kind],
                  r.kind === 'gap' && 'border-border border border-dashed bg-transparent',
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            )
            return (
              <li
                key={r.id}
                data-testid="call-row"
                className={cn(
                  GRID,
                  'group hover:bg-hover-subtle min-h-8 rounded-sm px-2 py-1 text-sm',
                  slow && 'bg-apm-warning/10',
                )}
              >
                <span
                  className="flex min-w-0 items-center gap-1.5"
                  style={{ paddingLeft: `${r.depth * 14}px` }}
                >
                  {expandable ? (
                    <button
                      type="button"
                      aria-label={`${isCollapsed ? '펼치기' : '접기'} ${r.name}`}
                      aria-expanded={!isCollapsed}
                      onClick={() => toggle(r.id)}
                      className="text-text-secondary hover:text-text-primary focus-visible:ring-accent shrink-0 rounded-sm focus-visible:ring-1 focus-visible:outline-none"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  ) : (
                    <span className="inline-block w-4 shrink-0" />
                  )}
                  {badge && (
                    <NeuBadge variant={badge.variant} className="shrink-0 text-[0.6875rem]">
                      {badge.label}
                    </NeuBadge>
                  )}
                  {jump ? (
                    <button
                      type="button"
                      title={r.name}
                      onClick={() => onJumpSql(r.sqlId)}
                      className="text-text-primary hover:text-accent focus-visible:text-accent min-w-0 truncate text-left hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {r.name}
                    </button>
                  ) : (
                    <span
                      title={r.name}
                      className={cn(
                        'min-w-0 truncate',
                        r.kind === 'gap' ? 'text-text-secondary italic' : 'text-text-primary',
                      )}
                    >
                      {r.name}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'font-num text-right tabular-nums',
                    slow ? 'text-apm-warning-text font-semibold' : 'text-text-secondary',
                  )}
                >
                  {r.durMs.toLocaleString()}
                </span>
                <span
                  className={cn(
                    'font-num text-right tabular-nums',
                    slow ? 'text-apm-warning-text font-semibold' : 'text-text-tertiary',
                  )}
                >
                  {(r.ratio * 100).toFixed(1)}%
                </span>
                {/* 타임라인 열 — 막대는 이 열 안에서만 그린다 (넓을 때 우측, 좁을 때 라벨 아래 얇게) */}
                <div
                  aria-hidden="true"
                  className="relative col-span-3 mt-1 h-2 @min-[720px]:col-span-1 @min-[720px]:mt-0 @min-[720px]:h-4"
                >
                  {ticks.slice(1, -1).map((t) => (
                    <span
                      key={t.frac}
                      className="bg-border/40 absolute inset-y-0 hidden w-px @min-[720px]:block"
                      style={{ left: `${t.frac * 100}%` }}
                    />
                  ))}
                  {bar}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
