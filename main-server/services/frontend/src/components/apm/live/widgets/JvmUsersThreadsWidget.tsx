import { jvmNum, mergeSeries, pickActive, pickAgg } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { MiniChart } from './MiniChart'

/** 동시 사용자 = 현재 진행 중 트랜잭션 수(큐 합계). 활성 스레드는 JVM 지표. */
export function JvmUsersThreadsWidget({ events, target }: WidgetProps) {
  const users = pickActive(events.active, target).reduce(
    (s, e) => s + e.buckets.reduce((a, b) => a + b, 0),
    0,
  )
  const threads = mergeSeries(pickAgg(events.agg, target), (e) => jvmNum(e, 'threads'), 'sum')
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="text-text-secondary text-xs">
        동시 사용자 <span className="text-text-primary text-lg font-semibold">{users}</span>
      </div>
      <div className="min-h-0 flex-1">
        <MiniChart
          lines={[{ label: '활성 스레드', colorVar: '--color-accent', points: threads }]}
          format={(v) => String(Math.round(v))}
        />
      </div>
    </div>
  )
}
