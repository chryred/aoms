import { describe, it, expect } from 'vitest'
import { mergedTimestamps, nearestIndex, pointAt } from '@/lib/apm/chartHover'

describe('nearestIndex', () => {
  const ts = [1000, 2000, 3000, 5000]
  it('빈 배열은 -1', () => expect(nearestIndex([], 5)).toBe(-1))
  it('원소 하나면 항상 0', () => expect(nearestIndex([7], 100)).toBe(0))
  it('범위 밖은 양 끝으로 스냅', () => {
    expect(nearestIndex(ts, -50)).toBe(0)
    expect(nearestIndex(ts, 99999)).toBe(3)
  })
  it('정확히 일치하면 그 인덱스', () => {
    expect(nearestIndex(ts, 3000)).toBe(2)
  })
  it('가까운 쪽으로 스냅하고 동거리면 앞쪽', () => {
    expect(nearestIndex(ts, 2400)).toBe(1)
    expect(nearestIndex(ts, 2600)).toBe(2)
    expect(nearestIndex(ts, 2500)).toBe(1)
    expect(nearestIndex(ts, 4100)).toBe(3)
  })
  it('선형 탐색과 결과가 같다(무작위 대조)', () => {
    const arr = Array.from({ length: 300 }, (_, i) => i * 1000 + (i % 7) * 13)
    for (let t = -500; t < 300000; t += 777) {
      let best = 0
      for (let i = 1; i < arr.length; i++) {
        if (Math.abs(arr[i] - t) < Math.abs(arr[best] - t)) best = i
      }
      expect(nearestIndex(arr, t)).toBe(best)
    }
  })
})

describe('mergedTimestamps / pointAt', () => {
  const a = [
    { ts: 1000, value: 1 },
    { ts: 3000, value: 3 },
  ]
  const b = [
    { ts: 1000, value: 5 },
    { ts: 2000, value: 6 },
  ]
  it('합집합을 오름차순·중복 없이 만든다', () => {
    expect(mergedTimestamps([{ points: a }, { points: b }])).toEqual([1000, 2000, 3000])
  })
  it('pointAt 은 정확히 같은 ts 만 돌려준다', () => {
    expect(pointAt(a, 3000)?.value).toBe(3)
    expect(pointAt(a, 2000)).toBeUndefined()
    expect(pointAt([], 1)).toBeUndefined()
  })
})
