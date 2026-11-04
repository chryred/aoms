import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { barRange, timeTicks } from '@/lib/apm/timeScale'
import { cn, formatKST, normalizeUtc } from '@/lib/utils'
import type { TxSummary } from '@/types/apm'

/** AP / SQL / Remote 구간 색 — 콜 트리 막대와 같은 조용한 토큰 */
const SEG = {
  ap: { label: 'AP', cls: 'bg-text-tertiary/50' },
  sql: { label: 'SQL', cls: 'bg-apm-normal' },
  ext: { label: 'Remote', cls: 'apm-seg-remote' },
} as const

/** 라벨 | 막대 | 경과 — 좁으면 막대를 라벨 아래로 내린다 */
const GRID = cn(
  'grid items-center gap-x-3 gap-y-0.5',
  'grid-cols-[minmax(0,1fr)_72px]',
  '@min-[640px]:grid-cols-[minmax(0,32%)_minmax(0,1fr)_72px]',
)

const TRACK = 'relative col-span-2 h-2 @min-[640px]:col-span-1 @min-[640px]:h-4'

/** 같은 trace_id 의 모든 시스템 요약을 공통 스케일의 얇은 막대(AP/SQL/Remote 구간)로 표시한다. */
export function TxPathTab({ path, current }: { path: TxSummary[]; current: TxSummary }) {
  const navigate = useNavigate()
  const rows = [...path].sort((a, b) => a.start_ts.localeCompare(b.start_ts))
  if (rows.length === 0) return null
  const startOf = (r: TxSummary) => new Date(normalizeUtc(r.start_ts)).getTime()
  const t0 = Math.min(...rows.map(startOf))
  const span = Math.max(1, ...rows.map((r) => startOf(r) - t0 + r.elapsed_ms))
  const ticks = timeTicks(span)

  return (
    <div className="@container min-w-0" data-testid="path-timeline">
      <div className={cn(GRID, 'text-text-tertiary border-border border-b px-2 pb-1 text-xs')}>
        <span className="font-num tabular-nums">{formatKST(rows[0].start_ts, 'HH:mm:ss.SSS')}</span>
        {/* 좁으면 막대 열과 같은 폭으로 라벨 아래 한 줄을 차지하고 시작/중간/끝 눈금만 남긴다 */}
        <div className="relative col-span-2 h-4 @min-[640px]:col-span-1" aria-hidden="true">
          {ticks.map((t) => (
            <span
              key={t.frac}
              className={cn(
                'font-num absolute top-0 tabular-nums',
                t.frac % 0.5 !== 0 && 'hidden @min-[640px]:block',
              )}
              style={{ left: `${t.frac * 100}%`, transform: `translateX(-${t.frac * 100}%)` }}
            >
              {t.frac === 0 ? '0' : `+${t.ms.toLocaleString()}`}
            </span>
          ))}
        </div>
        <span className="col-start-2 row-start-1 text-right @min-[640px]:col-start-3">
          경과(ms)
        </span>
      </div>
      <ul>
        {rows.map((r) => {
          const isCurrent = r.span_id === current.span_id
          const ext = Math.max(0, r.ext_ms ?? 0)
          const sql = Math.max(0, r.sql_ms)
          const ap = Math.max(0, r.elapsed_ms - sql - ext)
          const { left, width } = barRange(startOf(r) - t0, r.elapsed_ms, span)
          const segs = [
            { key: 'ap', ms: ap },
            { key: 'sql', ms: sql },
            { key: 'ext', ms: ext },
          ] as const
          const sum = Math.max(1, ap + sql + ext)
          return (
            <li key={r.span_id}>
              <button
                type="button"
                data-testid="path-row"
                data-current={isCurrent ? 'true' : undefined}
                title="이 span 의 상세를 새 탭으로 엽니다"
                onClick={() => navigate(ROUTES.apmTx(r.trace_id, r.span_id))}
                className={cn(
                  GRID,
                  'hover:bg-hover-subtle focus-visible:ring-accent group min-h-8 w-full rounded-sm px-2 py-1.5 text-left text-sm focus-visible:ring-1 focus-visible:outline-none',
                  isCurrent && 'bg-hover-subtle',
                )}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    className={cn(
                      'shrink-0',
                      isCurrent ? 'text-text-primary font-semibold' : 'text-text-primary',
                    )}
                  >
                    {r.system_name} · {r.instance_role}
                  </span>
                  <span className="text-text-tertiary min-w-0 truncate text-xs" title={r.uri}>
                    {r.uri}
                  </span>
                </span>
                <span className="font-num text-text-secondary col-start-2 row-start-1 text-right tabular-nums @min-[640px]:col-start-3">
                  {r.elapsed_ms.toLocaleString()}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(TRACK, '@min-[640px]:col-start-2 @min-[640px]:row-start-1')}
                >
                  {ticks.slice(1, -1).map((t) => (
                    <span
                      key={t.frac}
                      className="bg-border/40 absolute inset-y-0 hidden w-px @min-[640px]:block"
                      style={{ left: `${t.frac * 100}%` }}
                    />
                  ))}
                  <span
                    data-testid="path-bar"
                    className={cn(
                      'absolute top-1/2 flex h-1.5 min-w-[2px] -translate-y-1/2 overflow-hidden rounded-sm opacity-80 group-hover:opacity-100',
                      r.error && 'ring-critical ring-1',
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {segs.map(
                      (g) =>
                        g.ms > 0 && (
                          <span
                            key={g.key}
                            data-seg={g.key}
                            className={SEG[g.key].cls}
                            style={{ width: `${(g.ms / sum) * 100}%` }}
                          />
                        ),
                    )}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="text-text-tertiary mt-2 flex flex-wrap items-center gap-x-3 px-2 text-xs">
        {Object.values(SEG).map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className={cn('h-1.5 w-3 rounded-sm', s.cls)} aria-hidden="true" />
            {s.label}
          </span>
        ))}
        <span className="ml-auto">
          {formatKST(rows[0].start_ts, 'HH:mm:ss')} 시작 · 총 {span.toLocaleString()}ms
        </span>
      </div>
    </div>
  )
}
