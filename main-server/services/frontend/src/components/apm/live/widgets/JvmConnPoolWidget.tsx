import { useContext, useEffect, useRef, useState, type RefObject } from 'react'
import {
  connUsedNum,
  hasConnPeak,
  jvmNum,
  latestPoolRows,
  mergeSeries,
  pickAgg,
  poolLevel,
  poolUsed,
} from '@/lib/apm/liveData'
import type { PoolRow } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { LiveContext } from '@/components/apm/live/LiveContext'
import { ChartScaleContext, chartFonts } from '@/components/apm/live/chartScale'
import { MiniChart } from './MiniChart'

const EMPTY_TEXT = '커넥션 풀 정보가 없습니다 (Agent-T 버전 또는 풀 MBean 미노출)'
const NO_POOL_TEXT = '풀별 정보 없음'
/** 높이를 잴 수 없을 때(ResizeObserver 없음) 카드/확대 오버레이에서 보여줄 풀 행 수 */
const TOP_N = 5
const TOP_N_ZOOM = 12
/** 이 폭(px) 미만이면 차트와 목록을 좌우로 나누지 않는다 */
const SPLIT_MIN_W = 440
/** 세로로 쌓을 때 차트가 최소로 차지하는 높이(px). 이보다 남지 않으면 목록만 보인다 */
const STACK_CHART_H = 110
const STACK_MIN_H = 250
/** 목록 행 간격(px, gap-1.5) / 행 구성 높이(px) */
const ROW_GAP = 6
const LINE_H = 16
const BAR_H = 4

const LEVEL_VAR = {
  normal: '--color-apm-normal',
  warning: '--color-apm-warning',
  critical: '--color-apm-critical',
} as const

/** 요소 크기를 ResizeObserver 로 잰다. 측정 불가 환경에서는 0 을 유지한다. */
function useBox(ref: RefObject<HTMLElement | null>, mounted: boolean) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, mounted])
  return box
}

/**
 * 목록 높이에 맞춰 보여줄 행 수. 넘치면 "외 n개" 한 줄을 남기고 계산해 스크롤 없이 항상 보이게 한다.
 * 높이를 알 수 없으면(0) 고정 개수로 되돌아간다.
 */
function fitCount(total: number, boxH: number, rowH: number, fallback: number): number {
  if (boxH <= 0) return Math.min(total, fallback)
  const fits = (h: number) => Math.floor((h + ROW_GAP) / (rowH + ROW_GAP))
  if (fits(boxH) >= total) return total
  return Math.max(1, fits(boxH - LINE_H - ROW_GAP))
}

function PoolList({
  rows,
  multi,
  scale,
  boxH,
}: {
  rows: PoolRow[]
  multi: boolean
  scale: number
  boxH: number
}) {
  const ctx = useContext(LiveContext)
  const fonts = chartFonts(scale)
  const fs = fonts.axis + 1
  // 행 높이: 이름 줄(인스턴스 라벨은 같은 줄) + 막대 (글자 크기에 비례)
  const line = Math.max(LINE_H, Math.round(fs * 1.6))
  const rowH = line + BAR_H + 2
  const count = fitCount(rows.length, boxH, rowH, scale > 1 ? TOP_N_ZOOM : TOP_N)
  const shown = rows.slice(0, count)
  return (
    <ul
      data-testid="pool-list"
      aria-label="풀별 사용률"
      style={{ fontSize: fs }}
      className="flex min-w-0 flex-col gap-1.5"
    >
      {shown.map((r) => {
        const level = poolLevel(r)
        const inst = multi ? ctx.labelOf(r.instance) : ''
        const used = poolUsed(r)
        const pct = r.max > 0 ? Math.min(100, (used / r.max) * 100) : 0
        return (
          <li
            key={`${r.instance}|${r.kind}|${r.name}`}
            data-testid="pool-row"
            data-level={level}
            title={inst ? `${inst} · ${r.name}` : r.name}
          >
            {/* 풀 이름이 주(主): 줄어들지 않고(최대 75%), 보조 인스턴스 라벨이 먼저 잘린다 */}
            <div style={{ height: line }} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span
                  data-testid="pool-name"
                  className="text-text-primary max-w-[75%] flex-none truncate"
                >
                  {r.name}
                </span>
                {inst && (
                  <span
                    data-testid="pool-instance"
                    style={{ fontSize: fs - 1 }}
                    className="text-text-tertiary min-w-0 truncate"
                  >
                    {inst}
                  </span>
                )}
              </span>
              <span className="text-text-secondary shrink-0 tabular-nums">
                {r.active}/{r.max > 0 ? r.max : '-'}
                {r.peak !== undefined && r.peak > r.active && (
                  <span
                    data-testid="pool-peak"
                    title="최근 5초 동안 사용 중이던 커넥션 최대치"
                    className="text-text-tertiary ml-1.5"
                  >
                    최대 {r.peak}
                  </span>
                )}
                {r.wait > 0 && (
                  <span
                    data-testid="pool-wait"
                    className="ml-1.5 font-semibold"
                    style={{ color: 'var(--color-apm-critical-text)' }}
                  >
                    대기 {r.wait}
                  </span>
                )}
              </span>
            </div>
            {/* 트랙은 border-alt: 밝은 테마에서도 경고(노랑) 막대와 구분되는 대비 */}
            <div style={{ height: BAR_H }} className="bg-border-alt/50 overflow-hidden rounded-sm">
              <div
                data-testid="pool-bar"
                className="h-full rounded-sm"
                style={{ width: `${pct}%`, background: `var(${LEVEL_VAR[level]})` }}
              />
            </div>
          </li>
        )
      })}
      {rows.length > shown.length && (
        <li
          data-testid="pool-more"
          style={{ height: LINE_H }}
          className="text-text-tertiary leading-4"
        >
          외 {rows.length - shown.length}개
        </li>
      )}
    </ul>
  )
}

/**
 * DB 커넥션 풀: 합계 사용 중/최대 라인 차트 + 풀별 사용률 목록(사용률 내림차순).
 * 합계 max 는 풀이 많으면 부풀려지므로(예: 29풀 659) 포화 여부는 풀별 목록으로 본다.
 * 레이아웃은 위젯 자신의 크기로 정한다: 넓으면 좌우, 좁고 높으면 위아래, 작으면 목록만.
 */
export function JvmConnPoolWidget({ events, target }: WidgetProps) {
  const scale = useContext(ChartScaleContext)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const lists = pickAgg(events.agg, target)
  // 5초 창 최대(conn_peak)를 우선, 구 에이전트는 시점 값(conn_active)
  const peakMode = hasConnPeak(lists)
  const active = mergeSeries(lists, connUsedNum, 'sum')
  const max = mergeSeries(lists, (e) => jvmNum(e, 'conn_max'), 'sum')
  const rows = latestPoolRows(lists)
  // 풀 목록이 생겨 래퍼가 마운트되는 시점부터 잰다
  const hasRows = rows.length > 0
  const root = useBox(rootRef, hasRows)
  const list = useBox(listRef, hasRows)
  const hasSums = active.length > 0 || max.length > 0
  const chart = (extra?: string) => (
    <MiniChart
      lines={[
        // 합계 선은 중립 토큰: accent 는 인터랙션 전용, 정상 파랑과도 섞이지 않게 한다
        {
          label: peakMode ? '사용 중 (5초 최대)' : '사용 중',
          colorVar: '--color-text-secondary',
          points: active,
        },
        { label: '최대', colorVar: '--color-border-alt', points: max, dashed: true },
      ]}
      format={(v) => String(Math.round(v))}
      emptyText={EMPTY_TEXT}
      extra={extra}
    />
  )
  // 풀 목록이 없으면: 합계만 있을 땐 차트 + 안내, 합계도 없으면 차트의 빈 상태 문구
  if (rows.length === 0) return chart(hasSums ? NO_POOL_TEXT : undefined)

  // 폭을 아직 못 쟀으면(0) 좌우 배치로 시작한다
  const wide = root.w === 0 || root.w >= SPLIT_MIN_W
  const stacked = !wide && root.h >= STACK_MIN_H
  const listOnly = !wide && !stacked
  return (
    <div
      ref={rootRef}
      data-testid="pool-widget"
      data-layout={wide ? 'split' : stacked ? 'stack' : 'list'}
      className={`flex h-full min-h-0 gap-3 ${wide ? '' : 'flex-col'}`}
    >
      {!listOnly && (
        <div
          style={stacked ? { height: STACK_CHART_H, flexShrink: 0 } : undefined}
          className={wide ? 'min-w-0 flex-1' : 'min-w-0'}
        >
          {chart()}
        </div>
      )}
      <div
        ref={listRef}
        className={`min-h-0 min-w-0 overflow-hidden ${wide ? 'basis-[46%]' : 'flex-1'}`}
      >
        <PoolList rows={rows} multi={lists.length > 1} scale={scale} boxH={list.h} />
      </div>
    </div>
  )
}
