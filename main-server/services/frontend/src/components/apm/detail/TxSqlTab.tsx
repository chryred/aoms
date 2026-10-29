import type { TxSql } from '@/types/apm'

export function TxSqlTab({ sql }: { sql: TxSql[] }) {
  if (sql.length === 0) return <p className="text-text-secondary text-sm">실행된 SQL이 없습니다</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border text-text-secondary border-b text-xs">
            {['SQL', '실행 횟수', '시간(ms)', '최대(ms)', 'fetch 건수', 'fetch(ms)', '에러'].map(
              (h) => (
                <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {sql.map((s) => (
            <tr key={s.sql_id} className="border-border border-b align-top">
              <td className="max-w-[520px] px-3 py-2 font-mono text-xs break-all">{s.sql_text}</td>
              <td className="px-3 py-2">{s.cnt}</td>
              <td className="px-3 py-2">{s.ms.toLocaleString()}</td>
              <td className="px-3 py-2">{s.max_ms.toLocaleString()}</td>
              <td className="px-3 py-2">{s.fetch_cnt}</td>
              <td className="px-3 py-2">{s.fetch_ms.toLocaleString()}</td>
              <td className="text-critical-text px-3 py-2">{s.err || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
