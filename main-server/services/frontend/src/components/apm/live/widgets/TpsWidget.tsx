import { mergeSeries, pickAgg } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { MiniChart } from './MiniChart'

export function TpsWidget({ events, target }: WidgetProps) {
  const series = mergeSeries(pickAgg(events.agg, target), (e) => e.tps, 'sum')
  return <MiniChart lines={[{ label: 'TPS', colorVar: '--color-accent', points: series }]} />
}
