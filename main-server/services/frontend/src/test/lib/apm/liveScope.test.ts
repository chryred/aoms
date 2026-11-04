import { describe, it, expect } from 'vitest'
import { groupVitals, summarize, type TreeInstance } from '@/lib/apm/liveScope'
import type { LiveAggEvent } from '@/types/apm'

const inst = (cpu: number | null, heapPct: number | null): TreeInstance => ({
  key: 'k',
  systemId: 1,
  role: 'r',
  host: null,
  colorVar: '--t-series-1',
  status: 'live',
  cpu,
  heapPct,
  tps: null,
})

const agg = (tps: number, err_rate: number, avg_ms = 100): LiveAggEvent => ({
  system_id: 1,
  instance_role: 'a',
  ts: 1,
  tps,
  avg_ms,
  err_rate,
  slow_cnt: 0,
  uri_top: [],
  sql_top: [],
  jvm: null,
  dropped: { detail: 0, sql: 0, tx: 0 },
})

describe('groupVitals', () => {
  it('값이 있는 인스턴스만 평균낸다', () => {
    expect(groupVitals([inst(10, 40), inst(30, null), inst(null, 60)])).toEqual({
      cpu: 20,
      heap: 50,
    })
  })
  it('값이 하나도 없으면 null', () => {
    expect(groupVitals([inst(null, null)])).toEqual({ cpu: null, heap: null })
    expect(groupVitals([])).toEqual({ cpu: null, heap: null })
  })
})

describe('summarize 응답/초(TPS)', () => {
  it('tps 는 인스턴스 합이고 에러율은 평균(%)', () => {
    const s = summarize(
      {
        active: new Map(),
        agg: new Map([
          ['1:a', [agg(10, 0.2)]],
          ['1:b', [agg(5, 0)]],
        ]),
      },
      ['1:a', '1:b'],
    )
    expect(s.tps).toBe(15)
    expect(s).not.toHaveProperty('rps')
    expect(s.errRate).toBeCloseTo(10)
  })
})
