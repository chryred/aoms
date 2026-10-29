import type { StackSample } from '@/types/apm'

/** 미계측 구간에서 샘플링된 스택 — 많이 관측된 순. */
export function TxStackTab({ stacks }: { stacks: StackSample[] }) {
  if (stacks.length === 0)
    return <p className="text-text-secondary text-sm">수집된 스택 샘플이 없습니다</p>
  const sorted = [...stacks].sort((a, b) => b.c - a.c)
  return (
    <ul className="space-y-3">
      {sorted.map((s, idx) => (
        <li key={idx} className="bg-bg-deep rounded-sm p-3">
          <p className="text-text-secondary mb-1 text-xs">관측 {s.c}회</p>
          <pre className="font-mono text-xs break-all whitespace-pre-wrap">{s.f.join('\n')}</pre>
        </li>
      ))}
    </ul>
  )
}
