import { useMemo, useRef } from 'react'
import { niceMax, useElementSize } from '@/lib/apm/canvas'
import type { TxHourlyBucket } from '@/types/apm'

const HEIGHT = 220
const PAD = { l: 40, r: 44, t: 12, b: 22 }
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))

/** 시간대별(KST 00~23시) 건수(막대) + 평균 응답·SQL 평균(선). 좌축=건수, 우축=ms. */
export function TxHourlyChart({ items }: { items: TxHourlyBucket[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const { width } = useElementSize(wrapRef)
  const rows = useMemo(() => {
    const m = new Map(items.map((b) => [b.hour.padStart(2, '0'), b]))
    return HOURS.map((h) => m.get(h) ?? { hour: h, count: 0, elapsed_avg: 0, sql_avg_per_exec: 0 })
  }, [items])

  const pw = Math.max(1, width - PAD.l - PAD.r)
  const ph = HEIGHT - PAD.t - PAD.b
  const cMax = niceMax(Math.max(1, ...rows.map((r) => r.count)))
  const mMax = niceMax(Math.max(1, ...rows.map((r) => Math.max(r.elapsed_avg, r.sql_avg_per_exec))))
  const slot = pw / 24
  const cx = (i: number) => PAD.l + slot * i + slot / 2
  const yC = (v: number) => PAD.t + ph - (v / cMax) * ph
  const yM = (v: number) => PAD.t + ph - (v / mMax) * ph
  const line = (pick: (r: TxHourlyBucket) => number) =>
    rows
      .map((r, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)},${yM(pick(r)).toFixed(1)}`)
      .join(' ')

  if (!items.some((b) => b.count > 0))
    return <p className="text-text-secondary text-sm">조회 범위에 시간대별 데이터가 없습니다</p>

  return (
    <div>
      <div ref={wrapRef} className="w-full" style={{ height: HEIGHT }}>
        <svg
          role="img"
          aria-label="시간대별 트랜잭션 차트"
          width={width}
          height={HEIGHT}
          className="block"
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={PAD.l}
                x2={width - PAD.r}
                y1={yC(f * cMax)}
                y2={yC(f * cMax)}
                stroke="var(--color-border)"
                opacity={0.6}
              />
              <text
                x={PAD.l - 6}
                y={yC(f * cMax) + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--color-text-secondary)"
                className="font-num"
              >
                {Math.round(f * cMax).toLocaleString()}
              </text>
              <text
                x={width - PAD.r + 6}
                y={yM(f * mMax) + 3}
                fontSize={10}
                fill="var(--color-text-secondary)"
                className="font-num"
              >
                {Math.round(f * mMax).toLocaleString()}
              </text>
            </g>
          ))}
          {rows.map((r, i) => (
            <g key={r.hour}>
              <rect
                data-testid={`hourly-bar-${r.hour}`}
                x={cx(i) - slot * 0.32}
                width={slot * 0.64}
                y={yC(r.count)}
                height={Math.max(0, PAD.t + ph - yC(r.count))}
                fill="var(--t-series-1)"
                opacity={0.55}
              >
                <title>{`${r.hour}시 · ${r.count.toLocaleString()}건 · 평균 ${Math.round(r.elapsed_avg)}ms`}</title>
              </rect>
              {i % 2 === 0 && (
                <text
                  x={cx(i)}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--color-text-secondary)"
                  className="font-num"
                >
                  {r.hour}
                </text>
              )}
            </g>
          ))}
          <path
            d={line((r) => r.elapsed_avg)}
            fill="none"
            stroke="var(--t-series-2)"
            strokeWidth={1.75}
          />
          <path
            d={line((r) => r.sql_avg_per_exec)}
            fill="none"
            stroke="var(--t-series-4)"
            strokeWidth={1.75}
          />
        </svg>
      </div>
      <p className="text-text-tertiary mt-1 flex flex-wrap items-center gap-3 text-xs">
        <span className="inline-flex items-center gap-1">
          <i
            className="inline-block h-2 w-2 rounded-xs"
            style={{ background: 'var(--t-series-1)' }}
          />
          실행 건수(좌)
        </span>
        <span className="inline-flex items-center gap-1">
          <i
            className="inline-block h-2 w-2 rounded-xs"
            style={{ background: 'var(--t-series-2)' }}
          />
          평균 응답 ms(우)
        </span>
        <span className="inline-flex items-center gap-1">
          <i
            className="inline-block h-2 w-2 rounded-xs"
            style={{ background: 'var(--t-series-4)' }}
          />
          SQL 평균/실행 ms(우)
        </span>
        <span>KST</span>
      </p>
    </div>
  )
}
