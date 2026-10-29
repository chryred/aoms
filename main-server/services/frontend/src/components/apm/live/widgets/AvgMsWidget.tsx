import { mergeSeries, pickAgg } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { MiniChart } from './MiniChart'

export function AvgMsWidget({ events, target }: WidgetProps) {
  const series = mergeSeries(pickAgg(events.agg, target), (e) => e.avg_ms, 'mean')
  return (
    <MiniChart
      lines={[{ label: '평균 응답(ms)', colorVar: '--color-accent', points: series }]}
      format={(v) => `${Math.round(v)}ms`}
    />
  )
}
