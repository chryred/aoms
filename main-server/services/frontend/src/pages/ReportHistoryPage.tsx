import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { useReports } from '@/hooks/queries/useReports'
import { formatRelative, formatKST } from '@/lib/utils'
import type { ReportType } from '@/types/report'

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  daily: '일별', weekly: '주별', monthly: '월별',
  quarterly: '분기', half_year: '반기', annual: '연간',
}

const REPORT_TYPES: ReportType[] = ['daily', 'weekly', 'monthly', 'quarterly', 'half_year', 'annual']

export function ReportHistoryPage() {
  const [filterType, setFilterType] = useState<ReportType | ''>('')
  const [tooltip, setTooltip] = useState<number | null>(null)

  const { data: reports = [], isLoading } = useReports(
    filterType ? { report_type: filterType, limit: 30 } : { limit: 30 }
  )

  if (isLoading) return <LoadingSkeleton />

  return (
    <div>
      <PageHeader title="리포트 발송 이력" />

      {/* SubNav */}
      <div className="flex gap-1 mb-5 border-b border-[#C0C4CF]">
        <Link
          to="/reports"
          className="px-4 py-2 text-sm text-[#4A5568] hover:text-[#1A1F2E]"
        >
          안정성 리포트
        </Link>
        <span className="px-4 py-2 text-sm text-[#6366F1] border-b-2 border-[#6366F1] font-medium">
          발송 이력
        </span>
      </div>

      <div className="mb-4 w-48">
        <NeuSelect
          value={filterType}
          onChange={e => setFilterType(e.target.value as ReportType | '')}
        >
          <option value="">전체</option>
          {REPORT_TYPES.map(t => (
            <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>
          ))}
        </NeuSelect>
      </div>

      {reports.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-10 h-10" />}
          title="발송 이력이 없습니다"
        />
      ) : (
        <div className="rounded-2xl bg-[#E8EBF0] shadow-[6px_6px_12px_#C8CBD4,-6px_-6px_12px_#FFFFFF] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#C0C4CF]">
                {['유형', '기간', '발송 시각', '상태', '시스템 수', '요약'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#4A5568]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map(r => {
                const periodStr = `${formatKST(r.period_start, 'date')} ~ ${formatKST(r.period_end, 'date')}`
                const summary = r.llm_summary ?? ''
                const truncated = summary.length > 80 ? summary.slice(0, 80) + '…' : summary

                return (
                  <tr
                    key={r.id}
                    className="border-b border-[#C0C4CF] last:border-0 hover:bg-[rgba(0,0,0,0.02)]"
                  >
                    <td className="px-4 py-3">
                      <NeuBadge variant="info">
                        {REPORT_TYPE_LABELS[r.report_type] ?? r.report_type}
                      </NeuBadge>
                    </td>
                    <td className="px-4 py-3 text-[#4A5568] whitespace-nowrap">{periodStr}</td>
                    <td className="px-4 py-3 text-[#4A5568]">{formatRelative(r.sent_at)}</td>
                    <td className="px-4 py-3">
                      <NeuBadge variant={r.teams_status === 'sent' ? 'normal' : r.teams_status === 'failed' ? 'critical' : 'muted'}>
                        {r.teams_status === 'sent' ? '발송 완료' : r.teams_status === 'failed' ? '발송 실패' : '-'}
                      </NeuBadge>
                    </td>
                    <td className="px-4 py-3 text-[#4A5568]">
                      {r.system_count != null ? `${r.system_count}개` : '-'}
                    </td>
                    <td className="px-4 py-3 text-[#4A5568] relative">
                      {summary.length > 80 ? (
                        <span
                          className="cursor-help"
                          onMouseEnter={() => setTooltip(r.id)}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          {truncated}
                          {tooltip === r.id && (
                            <span className="absolute bottom-full left-0 mb-1 z-10 w-64 bg-white border border-[#C0C4CF] rounded-lg p-2 text-xs shadow-lg whitespace-pre-wrap">
                              {summary}
                            </span>
                          )}
                        </span>
                      ) : (
                        truncated || '-'
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
