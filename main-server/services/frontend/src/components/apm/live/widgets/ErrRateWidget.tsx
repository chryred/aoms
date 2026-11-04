import { useContext } from 'react'
import { pickAgg } from '@/lib/apm/liveData'
import { LiveContext } from '@/components/apm/live/LiveContext'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { MiniChart } from './MiniChart'
import { seriesLines } from './seriesLines'

/** err_rate 는 0~1 비율로 가정해 % 로 표시한다. */
export function ErrRateWidget({ events, target }: WidgetProps) {
  const palette = useContext(LiveContext)
  const lines = seriesLines(pickAgg(events.agg, target), (e) => e.err_rate * 100, 'mean', palette, {
    label: '에러율',
    colorVar: '--color-critical',
  })
  return <MiniChart lines={lines} format={(v) => `${v.toFixed(2)}%`} />
}
