import { useMemo, useState } from 'react'
import { aggregateMethodStats, isFrameworkMethod } from '@/lib/apm/methodStats'
import type { StackSample, TxSummary } from '@/types/apm'

const TIP =
  '스택 샘플링 기반 추정치입니다. 샘플에 나타난 비율 × 계측되지 않은 시간(응답 − SQL − 외부)으로 계산하며 실제 측정값이 아닙니다.'

interface Props {
  stacks: StackSample[]
  summary: TxSummary
}

export function TxMethodStatsTab({ stacks, summary }: Props) {
  const [filter, setFilter] = useState('')
  const [hideFramework, setHideFramework] = useState(false)
  const unmeasured = Math.max(0, summary.elapsed_ms - summary.sql_ms - summary.ext_ms)
  const all = useMemo(() => aggregateMethodStats(stacks, unmeasured), [stacks, unmeasured])
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return all.filter(
      (r) =>
        (!hideFramework || !isFrameworkMethod(r.method)) &&
        (!q || r.method.toLowerCase().includes(q)),
    )
  }, [all, filter, hideFramework])

  if (all.length === 0)
    return (
      <p className="text-text-secondary text-sm">
        스택 샘플이 없는 트랜잭션입니다. 느린 구간이 짧으면 샘플이 생기지 않습니다
      </p>
    )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="메소드 필터"
          aria-label="메소드 필터"
          className="bg-bg-deep shadow-neu-inset text-text-primary focus-visible:ring-accent min-h-[32px] w-64 rounded-sm px-3 text-xs focus-visible:ring-1 focus-visible:outline-none"
        />
        <label className="text-text-primary flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={hideFramework}
            onChange={(e) => setHideFramework(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          JDK/프레임워크 제외
        </label>
      </div>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-bg-base sticky top-0 z-10">
            <tr className="border-border text-text-secondary border-b">
              <th scope="col" className="px-2 py-1.5 font-medium">
                메소드
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                샘플 수
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                self
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                비율
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium" title={TIP}>
                <span className="cursor-help" title={TIP}>
                  추정 시간(ms)
                </span>{' '}
                <span className="text-text-disabled" title={TIP}>
                  추정
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.method} data-testid="method-row" className="border-border border-b">
                <td className="px-2 py-1.5 font-mono break-all">{r.method}</td>
                <td className="font-num px-2 py-1.5 text-right">{r.inclusive}</td>
                <td className="font-num px-2 py-1.5 text-right">{r.self}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="bg-bg-deep h-2 w-24 shrink-0 overflow-hidden rounded-sm"
                      aria-hidden="true"
                    >
                      <div
                        className="h-full"
                        style={{ width: `${r.ratio}%`, background: 'var(--t-series-1)' }}
                      />
                    </div>
                    <span className="font-num text-text-secondary">{r.ratio.toFixed(1)}%</span>
                  </div>
                </td>
                <td className="font-num px-2 py-1.5 text-right">
                  {Math.round(r.estMs).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="text-text-secondary py-3 text-sm">조건에 맞는 메소드가 없습니다</p>
        )}
      </div>
      <p className="text-text-tertiary mt-2 text-xs">{TIP}</p>
    </div>
  )
}
