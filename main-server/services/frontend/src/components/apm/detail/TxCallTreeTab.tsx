import { useMemo } from 'react'
import { buildCallTree } from '@/lib/apm/callTree'
import type { TxNode } from '@/types/apm'

const KIND_BAR: Record<string, string> = {
  http: 'bg-text-secondary',
  sql: 'bg-normal',
  ext: 'bg-warning',
  gap: 'bg-border',
}

export function TxCallTreeTab({ nodes, totalMs }: { nodes: TxNode[]; totalMs: number }) {
  const rows = useMemo(() => buildCallTree(nodes, totalMs), [nodes, totalMs])
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.id} className="text-sm" style={{ paddingLeft: `${r.depth * 16}px` }}>
          <div className="flex justify-between gap-2">
            <span className={r.kind === 'gap' ? 'text-text-secondary italic' : 'text-text-primary'}>
              {r.name}
            </span>
            <span className="text-text-secondary whitespace-nowrap">
              {r.durMs.toLocaleString()}ms · {(r.ratio * 100).toFixed(1)}%
            </span>
          </div>
          <div className="bg-bg-deep relative h-2 rounded-sm">
            <div
              className={`absolute h-2 rounded-sm ${KIND_BAR[r.kind]}`}
              style={{
                left: `${totalMs > 0 ? (r.startMs / totalMs) * 100 : 0}%`,
                width: `${Math.max(0.5, r.ratio * 100)}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
