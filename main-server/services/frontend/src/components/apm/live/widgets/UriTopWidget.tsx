import { mergeTop, pickAgg } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { TopTable } from './TopTable'

export function UriTopWidget({ events, target }: WidgetProps) {
  const rows = mergeTop(
    pickAgg(events.agg, target),
    (e) => e.uri_top,
    (i) => i.uri,
  )
  return <TopTable head="URI" rows={rows} />
}
