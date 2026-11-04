import { describe, it, expect } from 'vitest'
import {
  applyLayout,
  droppedKeys,
  findAgentId,
  jvmNum,
  jvmPools,
  latestPoolRows,
  poolLevel,
  matchesTarget,
  mergeSeries,
  mergeTop,
  pickActive,
  pickAgg,
} from '@/lib/apm/liveData'
import { niceMax, pointsInRect, scatterScale, toMs } from '@/lib/apm/canvas'
import type { LiveActiveEvent, LiveAggEvent } from '@/types/apm'
import type { AgentInstance } from '@/types/agent'

const agg = (
  sys: number,
  role: string,
  ts: number,
  over: Partial<LiveAggEvent> = {},
): LiveAggEvent => ({
  system_id: sys,
  instance_role: role,
  ts,
  tps: 10,
  avg_ms: 100,
  err_rate: 0,
  slow_cnt: 0,
  uri_top: [{ uri: '/a', cnt: 2, ms: 200 }],
  sql_top: [],
  jvm: { threads: 50 },
  dropped: { detail: 0, sql: 0, tx: 0 },
  ...over,
})

describe('target 필터', () => {
  const e = { system_id: 1, instance_role: 'w1' }
  it('빈 systemIds 는 전체, instanceRole 은 정확히 일치', () => {
    expect(matchesTarget(e, { systemIds: [] })).toBe(true)
    expect(matchesTarget(e, { systemIds: [2] })).toBe(false)
    expect(matchesTarget(e, { systemIds: [1], instanceRole: 'w2' })).toBe(false)
    expect(matchesTarget(e, { systemIds: [1], instanceRole: 'w1' })).toBe(true)
  })
  it('pickActive / pickAgg', () => {
    const a = new Map<string, LiveActiveEvent>([
      ['1:w1', { ...e, ts: 1, slow_ms: 3000, buckets: [0, 0, 0], top: [] }],
      [
        '2:w1',
        { system_id: 2, instance_role: 'w1', ts: 1, slow_ms: 3000, buckets: [0, 0, 0], top: [] },
      ],
    ])
    expect(pickActive(a, { systemIds: [2] })).toHaveLength(1)
    const g = new Map([
      ['1:w1', [agg(1, 'w1', 1)]],
      ['3:x', []],
    ])
    expect(pickAgg(g, { systemIds: [] })).toHaveLength(1)
  })
})

describe('mergeSeries', () => {
  const lists = [[agg(1, 'a', 5000), agg(1, 'a', 10000)], [agg(1, 'b', 5100)]]
  it('sum: 5초 버킷으로 합산', () => {
    expect(mergeSeries(lists, (x) => x.tps, 'sum')).toEqual([
      { ts: 5000, value: 20 },
      { ts: 10000, value: 10 },
    ])
  })
  it('mean 과 null 건너뛰기', () => {
    const s = mergeSeries(lists, (x) => (x.instance_role === 'b' ? null : x.avg_ms), 'mean')
    expect(s).toEqual([
      { ts: 5000, value: 100 },
      { ts: 10000, value: 100 },
    ])
  })
})

describe('기타 헬퍼', () => {
  it('jvmNum', () => {
    expect(jvmNum(agg(1, 'a', 1), 'threads')).toBe(50)
    expect(jvmNum(agg(1, 'a', 1), 'nope')).toBeNull()
    expect(jvmNum(agg(1, 'a', 1, { jvm: null }), 'threads')).toBeNull()
  })
  it('droppedKeys 는 최근 이벤트의 합 > 0 인 인스턴스', () => {
    const m = new Map([
      ['1:a', [agg(1, 'a', 1, { dropped: { detail: 0, sql: 1, tx: 0 } })]],
      ['1:b', [agg(1, 'b', 1)]],
    ])
    expect(droppedKeys(m)).toEqual(['1:a'])
  })
  it('mergeTop 은 키별 합산 후 누적 시간 순 + limit', () => {
    const rows = mergeTop(
      [[agg(1, 'a', 1), agg(1, 'a', 2, { uri_top: [{ uri: '/b', cnt: 1, ms: 1000 }] })]],
      (e) => e.uri_top,
      (i) => i.uri,
      1,
    )
    expect(rows).toEqual([{ key: '/b', cnt: 1, ms: 1000 }])
  })
  it('applyLayout 은 일치하는 위젯만 좌표 갱신', () => {
    const w = (i: string) => ({ i, type: 'tps' as const, x: 0, y: 0, w: 4, h: 5 })
    const out = applyLayout([w('a'), w('b')], [{ i: 'a', x: 2, y: 3, w: 6, h: 7 }])
    expect(out[0]).toMatchObject({ x: 2, y: 3, w: 6, h: 7 })
    expect(out[1]).toEqual(w('b'))
  })
  it('findAgentId: role 일치 > 단일 에이전트 > null', () => {
    const ag = (id: number, label: string | null) => ({ id, label_info: label }) as AgentInstance
    expect(findAgentId([ag(1, '{"instance_role":"a"}'), ag(2, '{"instance_role":"b"}')], 'b')).toBe(
      2,
    )
    expect(findAgentId([ag(7, 'not json')], 'x')).toBe(7)
    expect(findAgentId([ag(1, null), ag(2, null)], 'x')).toBeNull()
  })
})

describe('canvas 순수 헬퍼', () => {
  it('niceMax', () => {
    expect(niceMax(0)).toBe(1000)
    expect(niceMax(1)).toBe(1)
    expect(niceMax(1800)).toBe(2000)
    expect(niceMax(4200)).toBe(5000)
    expect(niceMax(7000)).toBe(10000)
  })
  it('toMs 는 숫자/ISO 문자열(UTC naive 포함) 모두 처리', () => {
    expect(toMs(123)).toBe(123)
    expect(toMs('2026-10-30T00:00:00')).toBe(Date.parse('2026-10-30T00:00:00Z'))
  })
  it('scatterScale 왕복 및 pointsInRect', () => {
    const s = scatterScale(0, 1000, 2000, 120, 120, { l: 20, r: 0, t: 0, b: 20 })
    expect(s.x(0)).toBe(20)
    expect(s.x(1000)).toBe(120)
    expect(s.y(0)).toBe(100)
    expect(s.invX(s.x(500))).toBeCloseTo(500)
    expect(s.invY(s.y(1000))).toBeCloseTo(1000)
    const pts = [
      { ts: 100, elapsed_ms: 100 },
      { ts: 900, elapsed_ms: 1900 },
    ]
    const hit = pointsInRect(pts, s, { x0: 120, y0: 0, x1: 100, y1: 30 })
    expect(hit).toEqual([pts[1]])
  })
})

describe('커넥션 풀 헬퍼', () => {
  const p = (name: string, active: number, max: number, wait = 0) => ({
    name,
    kind: 'jeus',
    active,
    idle: 0,
    max,
    wait,
  })
  it('jvmPools: 없거나 잘못된 항목은 건너뛴다', () => {
    expect(jvmPools(agg(1, 'a', 1))).toEqual([])
    const e = agg(1, 'a', 1, {
      jvm: { pools: [p('ok', 1, 2), { name: '' }, null, { name: 'x', active: 'q' }] },
    })
    expect(jvmPools(e).map((x) => [x.name, x.active, x.max])).toEqual([
      ['ok', 1, 2],
      ['x', 0, 0],
    ])
  })
  it('poolLevel: 대기>0 또는 100% 이상 critical, 80% 이상 warning', () => {
    expect(poolLevel({ active: 1, max: 10, wait: 0 })).toBe('normal')
    expect(poolLevel({ active: 8, max: 10, wait: 0 })).toBe('warning')
    expect(poolLevel({ active: 10, max: 10, wait: 0 })).toBe('critical')
    expect(poolLevel({ active: 1, max: 10, wait: 1 })).toBe('critical')
    expect(poolLevel({ active: 9, max: 0, wait: 0 })).toBe('normal')
  })
  it('latestPoolRows: 사용률 내림차순, 동률은 대기·이름순', () => {
    const list = [
      agg(1, 'a', 1, {
        jvm: { pools: [p('b', 5, 10), p('a', 5, 10), p('c', 5, 10, 3), p('d', 9, 10)] },
      }),
    ]
    expect(latestPoolRows([list]).map((r) => r.name)).toEqual(['d', 'c', 'a', 'b'])
  })
})
