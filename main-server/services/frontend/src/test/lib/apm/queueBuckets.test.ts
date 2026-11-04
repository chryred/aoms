import { describe, it, expect } from 'vitest'
import {
  hitBar,
  queueBars,
  queueColor,
  queueTowers,
  scatterLevel,
  formatSec,
  withZeroBars,
} from '@/lib/apm/queueBuckets'
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

  it('트랜잭션 1건 = 블록 1개, 위험이 맨 아래 정상이 맨 위', () => {
    const t = queueTowers(bars, 200, 100)[0]
    expect(t.blocks.map((b) => b.level)).toEqual([
      'critical',
      'critical',
      'warning',
      'warning',
      'normal',
      'normal',
      'normal',
      'normal',
    ])
    expect(t.overflow).toBe(0)
    expect(t.blocks[0].y).toBeGreaterThan(t.blocks[7].y)
    expect(t.blocks[0].y + t.h).toBe(100)
    // 블록 사이 간격 2px
    expect(t.blocks[0].y - t.blocks[1].y).toBe(t.h + 2)
  })

  it('블록 크기는 4~12px, 건수가 적으면 12px', () => {
    const t = queueTowers(queueBars([evt(1, 'a', [1, 0, 0])]), 400, 100)[0]
    expect(t.h).toBe(12)
    const many = queueTowers(queueBars([evt(1, 'a', [200, 0, 0])]), 400, 100)[0]
    expect(many.h).toBe(4)
  })

  it('칸이 모자라면 정상부터 잘리고 "+N" 으로 넘친 건수를 낸다', () => {
    const t = queueTowers(queueBars([evt(1, 'a', [100, 3, 2])]), 400, 60)[0]
    expect(t.blocks.length + t.overflow).toBe(105)
    expect(t.overflow).toBeGreaterThan(0)
    expect(t.blocks.filter((b) => b.level === 'critical')).toHaveLength(2)
    expect(t.blocks.filter((b) => b.level === 'warning')).toHaveLength(3)
    // +N 라벨 칸은 블록 위 한 칸
    expect(t.topY).toBe(t.blocks[t.blocks.length - 1].y - t.h - 2)
  })

  it('폭이 좁으면 블록도 슬롯에 맞춰 줄어든다', () => {
    const t = queueTowers(
      queueBars(Array.from({ length: 30 }, (_, i) => evt(1, `w${i}`, [1, 0, 0]))),
      300,
      100,
    )
    expect(t[0].w).toBeLessThanOrEqual(8)
    expect(t[0].h).toBeLessThanOrEqual(8)
  })

  it('막대가 없으면 빈 배열', () => {
    expect(queueTowers([], 100, 100)).toEqual([])
  })

  it('x 좌표로 막대를 찾는다 (범위 밖은 null)', () => {
    expect(hitBar(bars, 200, 10)).toBe('1:was1')
    expect(hitBar(bars, 200, 150)).toBe('2:was2')
    expect(hitBar(bars, 200, 200)).toBe('2:was2')
    expect(hitBar(bars, 200, -1)).toBeNull()
    expect(hitBar([], 200, 10)).toBeNull()
  })
})

describe('withZeroBars', () => {
  const bars = queueBars([evt(1, 'was1', [2, 0, 0])])

  it('이벤트가 없는 인스턴스를 0건 막대로 채우고 정렬한다', () => {
    const out = withZeroBars(bars, ['1:was1', '1:was0', '2:api'])
    expect(out.map((b) => b.key)).toEqual(['1:was0', '1:was1', '2:api'])
    expect(out[0]).toMatchObject({ system_id: 1, instance_role: 'was0', total: 0 })
    expect(out[1].total).toBe(2)
  })

  it('키가 없으면 그대로 두고, 잘못된 키는 건너뛴다', () => {
    expect(withZeroBars(bars, undefined)).toBe(bars)
    expect(withZeroBars([], ['bad']).length).toBe(0)
  })

  it('0건 호스트는 블록이 없고 빈 슬롯 자리(baseY)만 갖는다', () => {
    const towers = queueTowers(withZeroBars([], ['1:a', '1:b']), 200, 100)
    expect(towers).toHaveLength(2)
    expect(towers.every((t) => t.blocks.length === 0 && t.overflow === 0 && t.w > 0)).toBe(true)
    expect(towers[0].baseY).toBe(100 - towers[0].h)
  })
})

describe('scatterLevel / formatSec', () => {
  it('에러는 응답 시간과 무관하게 error, 그 외는 임계값 구간', () => {
    expect(scatterLevel(10, true, 1000)).toBe('error')
    expect(scatterLevel(999, false, 1000)).toBe('normal')
    expect(scatterLevel(1000, false, 1000)).toBe('warning')
    expect(scatterLevel(3000, false, 1000)).toBe('critical')
  })
  it('초 표기', () => {
    expect(formatSec(1000)).toBe('1s')
    expect(formatSec(4500)).toBe('4.5s')
  })
})
