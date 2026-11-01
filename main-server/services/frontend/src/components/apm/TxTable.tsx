import { useNavigate } from 'react-router-dom'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { ROUTES } from '@/constants/routes'
import { formatKST } from '@/lib/utils'
import type { TxSummary } from '@/types/apm'

const HEAD = [
  '시작 시각',
  '시스템·인스턴스',
  'URI',
  '응답(ms)',
  'CPU(ms)',
  'SQL(ms/건)',
  'fetch',
  '예외',
  'IP',
  '상세',
]

export function TxTable({ items }: { items: TxSummary[] }) {
  const navigate = useNavigate()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border text-text-secondary border-b text-xs">
            {HEAD.map((h) => (
              <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((tx) => {
            const open = () => navigate(ROUTES.apmTx(tx.trace_id, tx.span_id))
            return (
              <tr
                key={`${tx.trace_id}-${tx.span_id}`}
                role="link"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => e.key === 'Enter' && open()}
                className="border-border hover:bg-bg-deep cursor-pointer border-b"
              >
                <td className="px-3 py-2 whitespace-nowrap">{formatKST(tx.start_ts)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {tx.system_name} · {tx.instance_role}
                </td>
                <td className="max-w-[320px] truncate px-3 py-2" title={tx.uri}>
                  {tx.uri}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {tx.elapsed_ms.toLocaleString()}
                  {tx.error ? (
                    <NeuBadge variant="critical" className="ml-2">
                      에러
                    </NeuBadge>
                  ) : null}
                </td>
                <td className="px-3 py-2">{tx.cpu_ms.toLocaleString()}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {tx.sql_ms.toLocaleString()} / {tx.sql_cnt}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {tx.fetch_cnt} ({tx.fetch_ms}ms)
                </td>
                <td className="text-critical-text px-3 py-2">{tx.exc_class}</td>
                <td className="px-3 py-2 whitespace-nowrap">{tx.user_ip}</td>
                <td className="px-3 py-2">
                  {tx.has_detail ? <NeuBadge variant="info">보유</NeuBadge> : '-'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
