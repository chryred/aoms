import { useContext } from 'react'
import { jvmNum, pickActive, pickAgg } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { LiveContext } from '@/components/apm/live/LiveContext'
import { MiniChart } from './MiniChart'
import { seriesLines } from './seriesLines'

/** 동시 사용자 = 현재 진행 중 트랜잭션 수(큐 합계). 활성 스레드는 JVM 지표. */
export function JvmUsersThreadsWidget({ events, target }: WidgetProps) {
  const users = pickActive(events.active, target).reduce(
    (s, e) => s + e.buckets.reduce((a, b) => a + b, 0),
    0,
  )
  const ctx = useContext(LiveContext)
  const lists = pickAgg(events.agg, target)
  // 값 옆 라벨이 인스턴스 이름만 보이면 숫자가 무엇인지 알 수 없으므로 항상 "스레드"를 붙인다
  const palette = {
    colorOf: ctx.colorOf,
    labelOf: (key: string) => (lists.length > 1 ? `${ctx.labelOf(key)} · 스레드` : '스레드'),
  }
  const threads = seriesLines(lists, (e) => jvmNum(e, 'threads'), 'sum', palette, {
    label: '스레드 합계',
    colorVar: '--color-accent',
  })
  return (
    <MiniChart
      lines={threads}
      format={(v) => String(Math.round(v))}
      extra={
        <>
          동시 사용자 <span className="text-text-primary font-semibold tabular-nums">{users}</span>
        </>
      }
    />
  )
}
