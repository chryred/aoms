import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { summarizeSql } from '@/lib/apm/sqlFormat'
import type { TxSql, TxSummary } from '@/types/apm'

/** 에러 정보 — 예외 클래스·HTTP 상태와 에러가 난 SQL. 예외 메시지/스택 원문은 수집하지 않는다. */
export function TxExceptionTab({ summary, sql }: { summary: TxSummary; sql: TxSql[] }) {
  const failedSql = sql.filter((s) => s.err > 0)
  const hasTxError = !!(summary.error || summary.exc_class)
  if (!hasTxError && failedSql.length === 0)
    return <p className="text-text-secondary text-sm">발생한 예외가 없습니다</p>
  return (
    <div className="space-y-4">
      {hasTxError && (
        <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-text-secondary">예외 클래스</dt>
          <dd className="text-critical-text font-mono break-all">{summary.exc_class || '-'}</dd>
          <dt className="text-text-secondary">HTTP 상태</dt>
          <dd>
            <NeuBadge variant="critical">
              {summary.method} {summary.status}
            </NeuBadge>
          </dd>
        </dl>
      )}
      {failedSql.length > 0 && (
        <div>
          <p className="text-text-secondary mb-1.5 text-xs">에러가 발생한 SQL</p>
          <ul className="space-y-1">
            {failedSql.map((s) => (
              <li key={s.sql_id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-[12ch] flex-1 truncate font-mono text-xs">
                  {summarizeSql(s.sql_text)}
                </span>
                {s.db && (
                  <span
                    title={`DB ${s.db}`}
                    className="text-text-tertiary bg-muted-bg max-w-[10rem] shrink-0 truncate rounded-sm px-1.5 text-[0.6875rem]"
                  >
                    {s.db}
                  </span>
                )}
                <span className="text-critical-text shrink-0">{s.err}건</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
