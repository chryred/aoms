import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { formatKST, normalizeUtc } from '@/lib/utils'
import type { TxSummary } from '@/types/apm'

/** 같은 trace_id 의 모든 시스템 요약을 시간축 위에 막대로 표시한다. */
export function TxPathTab({ path, current }: { path: TxSummary[]; current: TxSummary }) {
  const navigate = useNavigate()
  const rows = [...path].sort((a, b) => a.start_ts.localeCompare(b.start_ts))
  const t0 = Math.min(...rows.map((r) => new Date(normalizeUtc(r.start_ts)).getTime()))
  const span = Math.max(
    1,
    ...rows.map((r) => new Date(normalizeUtc(r.start_ts)).getTime() - t0 + r.elapsed_ms),
  )

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const offset = new Date(normalizeUtc(r.start_ts)).getTime() - t0
        const isCurrent = r.span_id === current.span_id
        return (
          <li key={r.span_id}>
            <button
              type="button"
              onClick={() => navigate(ROUTES.apmTx(r.trace_id, r.span_id))}
              className="hover:bg-bg-deep w-full rounded-sm p-2 text-left"
            >
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span className={isCurrent ? 'text-accent font-semibold' : 'text-text-primary'}>
                  {r.system_name} · {r.instance_role} · {r.uri}
                </span>
                <span className="text-text-secondary">
                  {formatKST(r.start_ts, 'HH:mm:ss')} · {r.elapsed_ms.toLocaleString()}ms
                </span>
              </div>
              <div className="bg-bg-deep relative mt-1 h-3 rounded-sm">
                <div
                  className={`absolute h-3 rounded-sm ${r.error ? 'bg-critical' : 'bg-text-secondary'}`}
                  style={{
                    left: `${(offset / span) * 100}%`,
                    width: `${Math.max(0.5, (r.elapsed_ms / span) * 100)}%`,
                  }}
                />
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
