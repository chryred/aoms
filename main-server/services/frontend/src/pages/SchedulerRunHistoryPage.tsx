import { useState } from 'react'
import { Activity } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { useSchedulerRuns } from '@/hooks/queries/useSchedulerRuns'
import { formatRelative, formatKST } from '@/lib/utils'
import type { SchedulerType } from '@/types/schedulerRun'

const TYPE_LABELS: Record<SchedulerType | '', string> = {
  '': '전체',
  analysis: '로그 분석',
  hourly: '1시간 집계',
  daily: '일별 집계',
  weekly: '주간 리포트',
  monthly: '월간 리포트',
  longperiod: '장기 리포트',
  trend: '추세 알림',
}

const SCHEDULER_TYPES: SchedulerType[] = [
  'analysis',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'longperiod',
  'trend',
]

function durationSec(started: string, finished: string): string {
  const ms =
    new Date(finished.endsWith('Z') ? finished : finished + 'Z').getTime() -
    new Date(started.endsWith('Z') ? started : started + 'Z').getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}초`
  return `${Math.round(ms / 60_000)}분`
}

export function SchedulerRunHistoryPage() {
  const [filterType, setFilterType] = useState<SchedulerType | ''>('')
  const [filterStatus, setFilterStatus] = useState<'ok' | 'error' | ''>('')
  const [tooltip, setTooltip] = useState<number | null>(null)

  const params = {
    scheduler_type: filterType || undefined,
    status: filterStatus || undefined,
    limit: 200,
  }

  const { data: runs = [], isLoading } = useSchedulerRuns(params)

  if (isLoading) return <LoadingSkeleton />

  return (
    <div>
      <PageHeader title="스케줄러 실행 이력" />

      <div className="mb-4 flex gap-3">
        <div className="w-44">
          <NeuSelect
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as SchedulerType | '')}
          >
            <option value="">전체 유형</option>
            {SCHEDULER_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </NeuSelect>
        </div>
        <div className="w-32">
          <NeuSelect
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'ok' | 'error' | '')}
          >
            <option value="">전체 상태</option>
            <option value="ok">정상</option>
            <option value="error">오류</option>
          </NeuSelect>
        </div>
        <span className="text-text-secondary self-center text-xs">{runs.length}건</span>
      </div>

      {runs.length === 0 ? (
        <EmptyState icon={<Activity className="h-10 w-10" />} title="실행 이력이 없습니다" />
      ) : (
        <div className="bg-bg-base shadow-neu-flat overflow-hidden rounded-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border border-b">
                {['유형', '상태', '시작', '소요', '분석', '오류', '오류 메시지'].map((h) => (
                  <th
                    key={h}
                    className="text-text-secondary px-4 py-3 text-left text-xs font-semibold"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const dur = durationSec(r.started_at, r.finished_at)
                const errMsg = r.error_message ?? ''
                const truncated = errMsg.length > 60 ? errMsg.slice(0, 60) + '…' : errMsg

                return (
                  <tr
                    key={r.id}
                    className={`border-border border-b last:border-0 hover:bg-[rgba(0,212,255,0.04)] ${r.status === 'error' ? 'border-l-critical border-l-2' : 'border-l-2 border-l-transparent'}`}
                  >
                    <td className="px-4 py-3">
                      <span className="text-text-primary text-sm font-medium">
                        {TYPE_LABELS[r.scheduler_type]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <NeuBadge variant={r.status === 'ok' ? 'normal' : 'critical'}>
                        {r.status === 'ok' ? '정상' : '오류'}
                      </NeuBadge>
                    </td>
                    <td className="text-text-secondary px-4 py-3 whitespace-nowrap">
                      {formatRelative(r.started_at)}
                      <span className="text-text-disabled ml-1 text-xs">
                        {formatKST(r.started_at, 'HH:mm')}
                      </span>
                    </td>
                    <td className="text-text-secondary px-4 py-3">{dur}</td>
                    <td className="text-text-secondary px-4 py-3">
                      {r.scheduler_type === 'analysis' ? (
                        <span className={r.analyzed_count > 0 ? 'text-text-primary' : ''}>
                          {r.analyzed_count}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.error_count > 0 ? (
                        <span className="text-critical font-medium">{r.error_count}</span>
                      ) : (
                        <span className="text-text-disabled">0</span>
                      )}
                    </td>
                    <td className="text-text-secondary relative px-4 py-3">
                      {errMsg.length > 60 ? (
                        <span
                          className="cursor-help"
                          onMouseEnter={() => setTooltip(r.id)}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          {truncated}
                          {tooltip === r.id && (
                            <span className="border-border bg-bg-base shadow-neu-flat absolute bottom-full left-0 z-10 mb-1 w-80 rounded-sm border p-2 text-xs whitespace-pre-wrap">
                              {errMsg}
                            </span>
                          )}
                        </span>
                      ) : (
                        truncated || <span className="text-text-disabled">-</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
