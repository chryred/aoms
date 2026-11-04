import { instanceKey, mergeSeries, type SeriesPoint } from '@/lib/apm/liveData'
import { SERIES_COUNT } from '@/lib/apm/liveScope'
import type { LiveAggEvent } from '@/types/apm'

export interface SeriesLine {
  label: string
  colorVar: string
  points: SeriesPoint[]
}

interface Palette {
  colorOf: (key: string) => string
  labelOf: (key: string) => string
}

/**
 * 인스턴스마다 한 줄씩(고정 시리즈 색). 인스턴스가 팔레트보다 많으면 한 줄로 합쳐 색 혼동을 막는다.
 * mode: 합칠 때의 방식 (TPS/스레드는 sum, 응답시간/에러율/CPU 는 mean).
 */
export function seriesLines(
  lists: LiveAggEvent[][],
  pick: (e: LiveAggEvent) => number | null,
  mode: 'sum' | 'mean',
  palette: Palette,
  merged: { label: string; colorVar: string },
): SeriesLine[] {
  if (lists.length === 0 || lists.length > SERIES_COUNT) {
    return [{ ...merged, points: mergeSeries(lists, pick, mode) }]
  }
  return lists.map((list) => {
    const key = instanceKey(list[0])
    return {
      label: palette.labelOf(key),
      colorVar: palette.colorOf(key),
      points: mergeSeries([list], pick, mode),
    }
  })
}
