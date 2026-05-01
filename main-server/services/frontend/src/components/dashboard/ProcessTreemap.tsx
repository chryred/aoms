import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { ProcessSummary } from '@/api/aggregations'

interface ProcessTreemapProps {
  data: ProcessSummary[]
}

function getTileColor(pct: number): string {
  if (pct >= 80) return 'bg-critical/20 border-critical/40'
  if (pct >= 60) return 'bg-warning/15 border-warning/30'
  if (pct >= 30) return 'bg-accent/10 border-accent/20'
  return 'bg-normal/10 border-normal/20'
}

function getTextColor(pct: number): string {
  if (pct >= 80) return 'text-critical'
  if (pct >= 60) return 'text-warning'
  return 'text-text-primary'
}

/**
 * 프로세스 사용량 Treemap — CPU/메모리 % 기반 타일 크기 + 사용량 색상
 */
export function ProcessTreemap({ data }: ProcessTreemapProps) {
  const [mode, setMode] = useState<'cpu' | 'mem'>('cpu')

  const total = data.reduce(
    (s, p) => s + Math.max(p[mode === 'cpu' ? 'cpu_percent' : 'mem_percent'], 0.1),
    0,
  )

  return (
    <div className="space-y-2">
      {/* CPU / 메모리 토글 */}
      <div className="bg-bg-base shadow-neu-pressed flex w-fit gap-1 rounded-sm p-1">
        {(['cpu', 'mem'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              'rounded-sm px-3 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.97]',
              mode === m
                ? 'bg-accent text-accent-contrast shadow-neu-flat font-semibold'
                : 'text-text-secondary hover:bg-hover-subtle hover:text-text-primary',
            )}
          >
            {m === 'cpu' ? 'CPU' : '메모리'}
          </button>
        ))}
      </div>

      {/* Treemap 그리드 */}
      <div className="flex flex-wrap gap-1.5">
        {data.map((proc) => {
          const pct = mode === 'cpu' ? proc.cpu_percent : proc.mem_percent
          const ratio = Math.max(pct, 0.1) / total
          const widthPct = Math.max(ratio * 100, 8)

          return (
            <div
              key={proc.name}
              className={cn('rounded-sm border p-2.5 transition-colors', getTileColor(pct))}
              style={{
                flexBasis: `calc(${widthPct}% - 6px)`,
                minWidth: '80px',
                flexGrow: 1,
              }}
            >
              <div className="text-text-primary truncate text-xs font-medium">{proc.name}</div>
              <div className={cn('mt-1 text-lg font-bold tabular-nums', getTextColor(pct))}>
                {pct.toFixed(1)}%
              </div>
              <div className="text-text-secondary mt-0.5 text-[10px]">
                {mode === 'cpu' ? 'CPU' : `${(proc.mem_bytes / 1024 / 1024).toFixed(0)} MB`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
