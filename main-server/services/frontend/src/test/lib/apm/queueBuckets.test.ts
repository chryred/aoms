import { describe, it, expect } from 'vitest'
import { hitBar, queueBars, queueColor, queueGeometry } from '@/lib/apm/queueBuckets'
import type { LiveActiveEvent } from '@/types/apm'

const evt = (system_id: number, role: string, buckets: number[]): LiveActiveEvent => ({
  system_id,
  instance_role: role,
  ts: 1,
  slow_ms: 3000,
  buckets,
  top: [],
})

describe('queueColor', () => {
  it('구간 경계: 정상 < T, 경고 T~3T, 위험 >= 3T', () => {
    expect(queueColor(2999, 3000)).toBe('normal')
    expect(queueColor(3000, 3000)).toBe('warning')
    expect(queueColor(8999, 3000)).toBe('warning')
    expect(queueColor(9000, 3000)).toBe('critical')
  })
})

describe('queueBars / queueGeometry / hitBar', () => {
  const bars = queueBars([evt(2, 'was2', [1, 1, 0]), evt(1, 'was1', [4, 2, 2])])

  it('시스템·역할 순 정렬과 합계', () => {
    expect(bars.map((b) => b.key)).toEqual(['1:was1', '2:was2'])
    expect(bars[0].total).toBe(8)
  })

  it('누락된 구간은 0 으로 채운다', () => {
    expect(queueBars([evt(1, 'a', [3])])[0].buckets).toEqual([3, 0, 0])
  })

  it('가장 큰 막대가 plot 높이를 채우고 구간이 아래부터 쌓인다', () => {
    const rects = queueGeometry(bars, 200, 118, 18)
    const first = rects[0]
    expect(first.segs.map((s) => s.level)).toEqual(['normal', 'warning', 'critical'])
    const top = Math.min(...first.segs.map((s) => s.y))
    expect(top).toBeCloseTo(0)
    expect(first.segs[0].y + first.segs[0].h).toBeCloseTo(100)
  })

  it('막대가 없으면 빈 배열', () => {
    expect(queueGeometry([], 100, 100)).toEqual([])
  })

  it('x 좌표로 막대를 찾는다 (범위 밖은 null)', () => {
    expect(hitBar(bars, 200, 10)).toBe('1:was1')
    expect(hitBar(bars, 200, 150)).toBe('2:was2')
    expect(hitBar(bars, 200, 200)).toBe('2:was2')
    expect(hitBar(bars, 200, -1)).toBeNull()
    expect(hitBar([], 200, 10)).toBeNull()
  })
})
