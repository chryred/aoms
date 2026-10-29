import { describe, it, expect } from 'vitest'
import { buildCallTree } from '@/lib/apm/callTree'
import type { TxNode } from '@/types/apm'

const node = (i: number, p: number, k: TxNode['k'], s: number, d: number): TxNode => ({
  i,
  p,
  k,
  n: `${k}-${i}`,
  s,
  d,
  sql_id: '',
})

describe('buildCallTree', () => {
  it('자식 사이와 마지막 자식 뒤 빈 구간을 미계측 행으로 삽입한다', () => {
    const rows = buildCallTree(
      [node(0, -1, 'http', 0, 100), node(1, 0, 'sql', 0, 10), node(2, 0, 'ext', 50, 20)],
      100,
    )
    expect(rows.map((r) => r.kind)).toEqual(['http', 'sql', 'gap', 'ext', 'gap'])
    const gaps = rows.filter((r) => r.kind === 'gap')
    expect(gaps).toHaveLength(2)
    expect(gaps[0]).toMatchObject({ startMs: 10, durMs: 40, depth: 1, name: '미계측 구간' })
    expect(gaps[0].ratio).toBeCloseTo(0.4)
    expect(gaps[1]).toMatchObject({ startMs: 70, durMs: 30 })
    expect(gaps[1].ratio).toBeCloseTo(0.3)
    expect(rows[1].ratio).toBeCloseTo(0.1)
  })

  it('첫 자식 앞 빈 구간도 미계측 행으로 삽입한다', () => {
    const rows = buildCallTree([node(0, -1, 'http', 0, 100), node(1, 0, 'sql', 30, 70)], 100)
    expect(rows.map((r) => r.kind)).toEqual(['http', 'gap', 'sql'])
    expect(rows[1]).toMatchObject({ startMs: 0, durMs: 30 })
    expect(rows[1].ratio).toBeCloseTo(0.3)
  })

  it('1ms 미만 빈 구간과 자식 없는 노드에는 행을 만들지 않는다', () => {
    const rows = buildCallTree(
      [node(0, -1, 'http', 0, 100), node(1, 0, 'sql', 0, 50), node(2, 0, 'sql', 50, 50)],
      100,
    )
    expect(rows.map((r) => r.kind)).toEqual(['http', 'sql', 'sql'])
  })

  it('중첩 자식은 깊이를 늘리고 자식 순서를 시작 시각으로 정렬한다', () => {
    const rows = buildCallTree(
      [node(0, -1, 'http', 0, 100), node(2, 1, 'sql', 5, 5), node(1, 0, 'ext', 0, 100)],
      100,
    )
    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      ['n0', 0],
      ['n1', 1],
      ['gap-1-0', 2],
      ['n2', 2],
      ['gap-1-10', 2],
    ])
  })
})
