import type { TxSummary } from '@/types/apm'

export function TxResourceTab({ summary }: { summary: TxSummary }) {
  const items: [string, number, boolean][] = [
    ['커넥션 open', summary.conn_open, false],
    ['커넥션 close', summary.conn_close, false],
    ['미반환(leak)', summary.conn_leak, summary.conn_leak > 0],
    ['미커밋(uncommit)', summary.conn_uncommit, summary.conn_uncommit > 0],
  ]
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map(([label, value, bad]) => (
        <div key={label}>
          <dt className="text-text-secondary text-xs">{label}</dt>
          <dd
            className={`text-xl font-semibold ${bad ? 'text-critical-text' : 'text-text-primary'}`}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
