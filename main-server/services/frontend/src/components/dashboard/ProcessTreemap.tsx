import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { ProcessSummary } from '@/api/aggregations'

function MemoryStackBar({
  others,
  trackedBytes,
}: {
  others: ProcessSummary
  trackedBytes: number
}) {
  const total = others.sys_total_bytes ?? 0
  if (!total) return null

  const cached = others.sys_cached_bytes ?? 0
  const free = others.sys_free_bytes ?? 0
  const anon = others.sys_anon_bytes ?? 0
  const buffers = others.sys_buffers_bytes ?? 0
  const slabUnreclaim = others.sys_slab_unreclaim_bytes ?? 0
  const jvmAnon = Math.max(anon - trackedBytes, 0)
  const othersRem = Math.max(others.mem_bytes - jvmAnon - buffers - slabUnreclaim, 0)

  const widthPct = (v: number) => `${Math.max((v / total) * 100, 0).toFixed(2)}%`
  const fmt = (b: number) =>
    b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`
  const pctLabel = (v: number) => `${((v / total) * 100).toFixed(1)}%`

  // 사용 중 세그먼트 — 포화색으로 명확히 구분
  const usedSegs = [
    {
      label: '추적 프로세스',
      bytes: trackedBytes,
      bar: 'bg-accent',
      dot: 'bg-accent',
      tip: 'RSS 기반 추적 프로세스',
    },
    {
      label: 'JVM/익명',
      bytes: jvmAnon,
      bar: 'bg-warning',
      dot: 'bg-warning',
      tip: 'JVM Heap·JIT·mmap-private',
    },
    {
      label: '커널 버퍼',
      bytes: buffers,
      bar: 'bg-warning/50',
      dot: 'bg-warning/50',
      tip: '커널 I/O 버퍼 (필요시 해제)',
    },
    {
      label: '커널 Slab',
      bytes: slabUnreclaim,
      bar: 'bg-critical/70',
      dot: 'bg-critical/70',
      tip: '커널 비회수 구조체 (고정)',
    },
    {
      label: '기타',
      bytes: othersRem,
      bar: 'bg-text-disabled',
      dot: 'bg-text-disabled',
      tip: 'PageTable, KernelStack 등',
    },
  ]
  // 시스템 관리 세그먼트 — 흰색 반투명으로 어두운 배경과 구분
  const sysSegs = [
    {
      label: '페이지 캐시',
      bytes: cached,
      bar: 'bg-white/15',
      dot: 'bg-white/40',
      tip: 'OS 파일 캐시 (자동 해제 가능)',
    },
    {
      label: '여유',
      bytes: free,
      bar: 'bg-white/5',
      dot: 'bg-white/20',
      tip: '즉시 사용 가능한 빈 공간',
    },
  ]
  const allSegs = [...usedSegs, ...sysSegs]

  return (
    <div className="border-border mb-4 border-t pt-3">
      {/* 스택 바 — gap-px 로 세그먼트 경계 표시 */}
      <div className="bg-bg-deep mb-2 flex h-4 w-full gap-px overflow-hidden rounded-sm">
        {allSegs.map(({ label, bytes, bar }) =>
          bytes > 1024 * 1024 ? (
            <div
              key={label}
              className={cn('h-full shrink-0', bar)}
              style={{ width: widthPct(bytes) }}
              title={`${label}: ${fmt(bytes)} (${pctLabel(bytes)})`}
            />
          ) : null,
        )}
      </div>

      {/* 범례 — 사용 중 / 시스템 관리 두 줄로 분리 */}
      <div className="space-y-1">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {usedSegs
            .filter(({ bytes }) => bytes > 1024 * 1024 * 5)
            .map(({ label, bytes, dot, tip }) => (
              <div key={label} className="flex items-center gap-1" title={tip}>
                <div className={cn('h-2 w-2 shrink-0 rounded-sm', dot)} />
                <span className="text-text-primary text-[10px] font-medium">{label}</span>
                <span className="text-text-secondary text-[10px]">
                  {fmt(bytes)} ({pctLabel(bytes)})
                </span>
              </div>
            ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {sysSegs.map(({ label, bytes, tip }) => (
            <div key={label} className="flex items-center gap-1" title={tip}>
              <div className="border-border h-2 w-2 shrink-0 rounded-sm border" />
              <span className="text-text-disabled text-[10px]">
                {label} {fmt(bytes)} ({pctLabel(bytes)})
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface ProcessTreemapProps {
  data: ProcessSummary[]
}

function getTileColor(pct: number, isOthers?: boolean): string {
  if (isOthers) return 'bg-surface border-border'
  if (pct >= 80) return 'bg-critical/20 border-critical/40'
  if (pct >= 60) return 'bg-warning/15 border-warning/30'
  if (pct >= 30) return 'bg-accent/10 border-accent/20'
  return 'bg-normal/10 border-normal/20'
}

function getTextColor(pct: number, isOthers?: boolean): string {
  if (isOthers) return 'text-text-secondary'
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
        const rawProcs = groups[role]
        const host = rawProcs[0]?.host ?? ''

        // 현재 모드 기준 내림차순 정렬, "기타 (미추적)"은 항상 마지막
        const procs = [...rawProcs]
          .filter((p) => !(mode === 'cpu' && p.name === '기타 (미추적)'))
          .sort((a, b) => {
            if (a.name === '기타 (미추적)') return 1
            if (b.name === '기타 (미추적)') return -1
            const va = mode === 'cpu' ? a.cpu_percent : a.mem_percent
            const vb = mode === 'cpu' ? b.cpu_percent : b.mem_percent
            return vb - va
          })

        const total = procs.reduce(
          (s, p) => s + Math.max(p[mode === 'cpu' ? 'cpu_percent' : 'mem_percent'], 0.1),
          0,
        )

        const othersEntry = rawProcs.find((p) => p.name === '기타 (미추적)')
        const trackedBytes = rawProcs
          .filter((p) => p.name !== '기타 (미추적)')
          .reduce((s, p) => s + p.mem_bytes, 0)

        return (
          <div key={role} className="bg-surface shadow-neu-flat rounded-sm p-3">
            {/* 서버 헤더 */}
            <div className="border-border mb-3 flex items-center gap-2 border-b pb-2">
              <span className="text-text-primary text-sm font-semibold">{role}</span>
              {host && <span className="text-text-secondary text-xs">{host}</span>}
            </div>

            {/* 전체 메모리 스택 바 — 메모리 모드 + 기타 항목 있을 때만 */}
            {mode === 'mem' && othersEntry && (
              <MemoryStackBar others={othersEntry} trackedBytes={trackedBytes} />
            )}

            {/* 타일 */}
            <div className="flex flex-wrap gap-1.5">
              {procs.map((proc) => {
                const isOthers = proc.name === '기타 (미추적)'
                const pct = mode === 'cpu' ? proc.cpu_percent : proc.mem_percent
                const ratio = Math.max(pct, 0.1) / total
                const widthPct = Math.max(ratio * 100, 8)

                return (
                  <div
                    key={`${proc.instance_role}-${proc.name}`}
                    className={cn(
                      'rounded-sm border p-2.5 transition-colors',
                      getTileColor(pct, isOthers),
                    )}
                    style={{
                      flexBasis: `calc(${widthPct}% - 6px)`,
                      minWidth: '80px',
                      flexGrow: 1,
                    }}
                  >
                    <div
                      className={cn(
                        'truncate text-xs font-medium',
                        isOthers ? 'text-text-secondary' : 'text-text-primary',
                      )}
                    >
                      {proc.name}
                    </div>
                    <div
                      className={cn(
                        'mt-1 text-lg font-bold tabular-nums',
                        getTextColor(pct, isOthers),
                      )}
                    >
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
