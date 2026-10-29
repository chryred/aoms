import { jvmNum, mergeSeries, pickAgg } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { MiniChart } from './MiniChart'

/** 계측 가능한 풀만 표시: jvm.conn_active / conn_max 가 있을 때. 없으면 안내 문구. */
export function JvmConnPoolWidget({ events, target }: WidgetProps) {
  const lists = pickAgg(events.agg, target)
  const active = mergeSeries(lists, (e) => jvmNum(e, 'conn_active'), 'sum')
  const max = mergeSeries(lists, (e) => jvmNum(e, 'conn_max'), 'sum')
  return (
    <MiniChart
      lines={[
        { label: '사용 중', colorVar: '--color-accent', points: active },
        { label: '최대', colorVar: '--color-border-alt', points: max },
      ]}
      format={(v) => String(Math.round(v))}
      emptyText="계측 가능한 커넥션 풀 없음"
    />
  )
}
