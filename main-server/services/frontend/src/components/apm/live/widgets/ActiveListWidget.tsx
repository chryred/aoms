import { useContext, useState } from 'react'
import { HTTPError } from 'ky'
import toast from 'react-hot-toast'
import { X } from 'lucide-react'
import { agentsApi } from '@/api/agents'
import { apmApi } from '@/api/apm'
import { findAgentId, instanceKey, pickActive } from '@/lib/apm/liveData'
import { queueColor } from '@/lib/apm/queueBuckets'
import { LiveContext } from '@/components/apm/live/LiveContext'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import type { ActiveTop } from '@/types/apm'

interface Row extends ActiveTop {
  system_id: number
  instance_role: string
  slow_ms: number
}

const TEXT_CLASS = {
  normal: 'text-normal-text',
  warning: 'text-warning-text',
  critical: 'text-critical-text',
} as const

export function ActiveListWidget({ events, target }: WidgetProps) {
  const { queueFilter, setQueueFilter, systemName } = useContext(LiveContext)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const rows: Row[] = pickActive(events.active, target)
    .filter((e) => queueFilter === null || instanceKey(e) === queueFilter)
    .flatMap((e) =>
      e.top.map((t) => ({
        ...t,
        system_id: e.system_id,
        instance_role: e.instance_role,
        slow_ms: e.slow_ms,
      })),
    )
    .sort((a, b) => b.elapsed_ms - a.elapsed_ms)
    .slice(0, 100)
  const selected = rows.find((r) => `${r.trace_id}:${r.span_id}` === selectedId) ?? null

  const requestDump = async (row: Row) => {
    try {
      const agents = await agentsApi.getAgents({ system_id: row.system_id, agent_type: 'agent_t' })
      const agentId = findAgentId(agents, row.instance_role)
      if (agentId == null) {
        toast.error('스레드 덤프를 요청할 에이전트를 찾을 수 없습니다')
        return
      }
      await apmApi.requestThreadDump(agentId)
      toast.success('스레드 덤프를 요청했습니다')
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 409)
        toast('진행 중인 스레드 덤프 요청이 있습니다')
      else toast.error('스레드 덤프 요청 중 오류가 발생했습니다')
    }
  }

  return (
    <div className="flex h-full flex-col gap-1 text-xs">
      {queueFilter && (
        <button
          type="button"
          onClick={() => setQueueFilter(null)}
          className="bg-accent-muted text-accent flex w-fit items-center gap-1 rounded-sm px-2 py-0.5"
        >
          필터: {queueFilter.replace(/^(\d+):/, (_, id) => `${systemName(Number(id))}/`)}{' '}
          <X size={12} aria-label="필터 해제" />
        </button>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="text-text-tertiary flex h-full items-center justify-center">
            진행 중인 트랜잭션 없음
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="text-text-secondary sticky top-0">
              <tr>
                <th className="bg-bg-base py-1 pr-2 font-medium">URI</th>
                <th className="bg-bg-base px-2 py-1 text-right font-medium">경과</th>
                <th className="bg-bg-base px-2 py-1 font-medium">단계</th>
                <th className="bg-bg-base py-1 pl-2 font-medium">스레드</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const id = `${r.trace_id}:${r.span_id}`
                return (
                  <tr
                    key={id}
                    onClick={() => setSelectedId(id === selectedId ? null : id)}
                    className={`border-border hover:bg-hover-subtle cursor-pointer border-t ${id === selectedId ? 'bg-accent-04' : ''}`}
                  >
                    <td className="text-text-primary max-w-0 truncate py-1 pr-2" title={r.uri}>
                      {r.uri}
                    </td>
                    <td
                      className={`px-2 py-1 text-right tabular-nums ${TEXT_CLASS[queueColor(r.elapsed_ms, r.slow_ms)]}`}
                    >
                      {r.elapsed_ms}ms
                    </td>
                    <td className="text-text-secondary max-w-0 truncate px-2 py-1" title={r.sql}>
                      {r.phase === 'sql' ? r.sql || 'sql' : r.phase}
                    </td>
                    <td className="text-text-secondary py-1 pl-2">{r.thread}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {selected && (
        <div className="border-border max-h-32 overflow-auto border-t pt-1">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-text-secondary">
              현재 스택 · {systemName(selected.system_id)}/{selected.instance_role}
            </span>
            <button
              type="button"
              onClick={() => void requestDump(selected)}
              className="bg-btn-secondary text-text-primary shadow-neu-flat rounded-sm px-2 py-0.5"
            >
              스레드 덤프
            </button>
          </div>
          <pre className="text-text-primary font-mono text-[11px] whitespace-pre-wrap">
            {selected.stack || '스택 정보 없음'}
          </pre>
        </div>
      )}
    </div>
  )
}
