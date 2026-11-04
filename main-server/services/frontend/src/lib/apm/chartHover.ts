import type { SeriesPoint } from '@/lib/apm/liveData'

/** 오름차순 배열에서 t 에 가장 가까운 원소의 인덱스(이분 탐색). 빈 배열이면 -1, 동거리면 앞쪽 */
export function nearestIndex(sorted: readonly number[], t: number): number {
  const n = sorted.length
  if (n === 0) return -1
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < t) lo = mid + 1
    else hi = mid
  }
  // lo = t 이상인 첫 원소. 직전 원소와 비교해 더 가까운 쪽을 고른다
  if (lo > 0 && t - sorted[lo - 1] <= sorted[lo] - t) return lo - 1
  return lo
}

/** 모든 시리즈의 타임스탬프 합집합(오름차순, 중복 제거) */
export function mergedTimestamps(lines: readonly { points: readonly SeriesPoint[] }[]): number[] {
  const set = new Set<number>()
  for (const l of lines) for (const p of l.points) set.add(p.ts)
  return [...set].sort((a, b) => a - b)
}

/** 시리즈(ts 오름차순)에서 ts 와 정확히 같은 점(이분 탐색). 없으면 undefined */
export function pointAt(points: readonly SeriesPoint[], ts: number): SeriesPoint | undefined {
  let lo = 0
  let hi = points.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const t = points[mid].ts
    if (t === ts) return points[mid]
    if (t < ts) lo = mid + 1
    else hi = mid - 1
  }
  return undefined
}
