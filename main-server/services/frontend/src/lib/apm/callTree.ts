import type { TxNode } from '@/types/apm'

export interface CallTreeRow {
  id: string
  depth: number
  kind: 'http' | 'sql' | 'ext' | 'gap'
  name: string
  startMs: number
  durMs: number
  /** 전체 응답시간 대비 비율 (0~1) */
  ratio: number
}

export const GAP_NAME = '미계측 구간'
const MIN_GAP_MS = 1

/**
 * 노드 목록(i=자기 인덱스, p=부모 인덱스)을 깊이 우선 순서의 행으로 펼치고,
 * 자식 사이·마지막 자식 뒤의 빈 구간(≥1ms)을 '미계측 구간' 행으로 삽입한다.
 */
export function buildCallTree(nodes: TxNode[], totalMs: number): CallTreeRow[] {
  const byId = new Map(nodes.map((n) => [n.i, n]))
  const children = new Map<number, TxNode[]>()
  const roots: TxNode[] = []
  for (const n of nodes) {
    if (n.p !== n.i && byId.has(n.p)) {
      const list = children.get(n.p) ?? []
      list.push(n)
      children.set(n.p, list)
    } else {
      roots.push(n)
    }
  }
  const ratio = (ms: number) => (totalMs > 0 ? ms / totalMs : 0)
  const byStart = (a: TxNode, b: TxNode) => a.s - b.s

  const rows: CallTreeRow[] = []
  const visit = (node: TxNode, depth: number) => {
    rows.push({
      id: `n${node.i}`,
      depth,
      kind: node.k,
      name: node.n,
      startMs: node.s,
      durMs: node.d,
      ratio: ratio(node.d),
    })
    const kids = (children.get(node.i) ?? []).sort(byStart)
    if (kids.length === 0) return
    const pushGap = (from: number, to: number) => {
      if (to - from < MIN_GAP_MS) return
      rows.push({
        id: `gap-${node.i}-${from}`,
        depth: depth + 1,
        kind: 'gap',
        name: GAP_NAME,
        startMs: from,
        durMs: to - from,
        ratio: ratio(to - from),
      })
    }
    let cursor = kids[0].s
    for (const kid of kids) {
      pushGap(cursor, kid.s)
      visit(kid, depth + 1)
      cursor = Math.max(cursor, kid.s + kid.d)
    }
    pushGap(cursor, node.s + node.d)
  }
  roots.sort(byStart).forEach((r) => visit(r, 0))
  return rows
}
