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
 * 프로세스 사용량 Treemap — 서버(instance_role)별 카드로 구분 + CPU/메모리 % 기반 타일 크기
 */
export function ProcessTreemap({ data }: ProcessTreemapProps) {
  const [mode, setMode] = useState<'cpu' | 'mem'>('cpu')

  const groups = data.reduce<Record<string, ProcessSummary[]>>((acc, proc) => {
    const key = proc.instance_role
    if (!acc[key]) acc[key] = []
    acc[key].push(proc)
    return acc
  }, {})

  const groupKeys = Object.keys(groups).sort()

  return (
    <div className="space-y-3">
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

      {/* 서버별 카드 */}
      {groupKeys.map((role) => {
        const procs = groups[role]
        const host = procs[0]?.host ?? ''
        const total = procs.reduce(
          (s, p) => s + Math.max(p[mode === 'cpu' ? 'cpu_percent' : 'mem_percent'], 0.1),
          0,
        )

        return (
          <div key={role} className="bg-surface shadow-neu-flat rounded-sm p-3">
            {/* 서버 헤더 */}
            <div className="border-border mb-3 flex items-center gap-2 border-b pb-2">
              <span className="text-text-primary text-sm font-semibold">{role}</span>
              {host && <span className="text-text-secondary text-xs">{host}</span>}
            </div>

            {/* 타일 */}
            <div className="flex flex-wrap gap-1.5">
              {procs.map((proc) => {
                const pct = mode === 'cpu' ? proc.cpu_percent : proc.mem_percent
                const ratio = Math.max(pct, 0.1) / total
                const widthPct = Math.max(ratio * 100, 8)

                return (
                  <div
                    key={`${proc.instance_role}-${proc.name}`}
                    className={cn('rounded-sm border p-2.5 transition-colors', getTileColor(pct))}
                    style={{
                      flexBasis: `calc(${widthPct}% - 6px)`,
                      minWidth: '80px',
                      flexGrow: 1,
                    }}
                  >
                    <div className="text-text-primary truncate text-xs font-medium">
                      {proc.name}
                    </div>
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
      })}
    </div>
  )
}
