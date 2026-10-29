import { mergeSeries, pickAgg } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { MiniChart } from './MiniChart'

/** err_rate 는 0~1 비율로 가정해 % 로 표시한다. */
export function ErrRateWidget({ events, target }: WidgetProps) {
  const series = mergeSeries(pickAgg(events.agg, target), (e) => e.err_rate * 100, 'mean')
  return (
    <MiniChart
      lines={[{ label: '에러율', colorVar: '--color-critical', points: series }]}
      format={(v) => `${v.toFixed(2)}%`}
    />
  )
}
