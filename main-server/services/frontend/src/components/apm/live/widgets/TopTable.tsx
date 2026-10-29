interface TopTableProps {
  head: string
  rows: { key: string; cnt: number; ms: number }[]
}

/** URI/SQL 상위 공용 표 (건수·누적 시간 기준). */
export function TopTable({ head, rows }: TopTableProps) {
  if (rows.length === 0) {
    return (
      <div className="text-text-tertiary flex h-full items-center justify-center text-xs">
        데이터 수집 중
      </div>
    )
  }
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-text-secondary sticky top-0">
          <tr>
            <th className="bg-bg-base py-1 pr-2 font-medium">{head}</th>
            <th className="bg-bg-base px-2 py-1 text-right font-medium">건수</th>
            <th className="bg-bg-base py-1 pl-2 text-right font-medium">누적(ms)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-border border-t">
              <td className="text-text-primary max-w-0 truncate py-1 pr-2" title={r.key}>
                {r.key}
              </td>
              <td className="text-text-secondary px-2 py-1 text-right tabular-nums">
                {r.cnt.toLocaleString()}
              </td>
              <td className="text-text-secondary py-1 pl-2 text-right tabular-nums">
                {Math.round(r.ms).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
