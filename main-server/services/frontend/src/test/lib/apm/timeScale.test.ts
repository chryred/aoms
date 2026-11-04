import { describe, expect, it } from 'vitest'
import { barRange, timeTicks } from '@/lib/apm/timeScale'

describe('timeScale', () => {
  it('눈금은 0, ¼, ½, ¾, 전체 5개', () => {
    expect(timeTicks(1000).map((t) => t.ms)).toEqual([0, 250, 500, 750, 1000])
  })
  it('막대 범위는 0~100% 로 자른다', () => {
    expect(barRange(250, 500, 1000)).toEqual({ left: 25, width: 50 })
    expect(barRange(900, 500, 1000)).toEqual({ left: 90, width: 10 })
    expect(barRange(0, 10, 0)).toEqual({ left: 0, width: 0 })
  })
})
