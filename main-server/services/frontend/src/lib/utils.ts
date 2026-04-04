import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { AnomalyType, Severity } from '@/types/alert'
import type { LlmSeverity } from '@/types/aggregation'
import type { ReportType } from '@/types/report'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// UTC → KST (UTC+9) 변환
export function formatKST(
  utcDate: string | Date,
  format: 'datetime' | 'date' | 'HH:mm' = 'datetime'
): string {
  const d = new Date(utcDate)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  if (format === 'HH:mm') return kst.toISOString().slice(11, 16)
  if (format === 'date') return kst.toISOString().slice(0, 10)
  return kst.toISOString().slice(0, 16).replace('T', ' ')
}

// 상대 시간 (1시간 이내: "3분 전", 이상: KST 절대)
export function formatRelative(utcDate: string): string {
  const diff = Date.now() - new Date(utcDate).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return '방금 전'
  if (mins < 60) return `${mins}분 전`
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `${hours}시간 전`
  return formatKST(utcDate, 'date')
}

export function severityColor(severity: Severity | string): string {
  switch (severity) {
    case 'critical': return 'text-[#DC2626]'
    case 'warning': return 'text-[#D97706]'
    default: return 'text-[#16A34A]'
  }
}

export function anomalyColor(type: AnomalyType | null): string {
  switch (type) {
    case 'duplicate': return 'bg-gray-100 text-gray-600 border-gray-200'
    case 'recurring': return 'bg-red-100 text-red-700 border-red-200'
    case 'related': return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    default: return 'bg-blue-100 text-blue-700 border-blue-200'
  }
}

export function summarizeMetrics(metricsJson: string, collectorType: string): string {
  try {
    const parsed = JSON.parse(metricsJson) as Record<string, number>
    if (collectorType === 'node_exporter') {
      const parts: string[] = []
      if ('cpu_avg' in parsed) parts.push(`CPU avg ${parsed.cpu_avg.toFixed(1)}%`)
      if ('mem_avg' in parsed) parts.push(`MEM avg ${parsed.mem_avg.toFixed(1)}%`)
      if ('disk_avg' in parsed) parts.push(`Disk avg ${parsed.disk_avg.toFixed(1)}%`)
      return parts.join(' | ')
    }
    if (collectorType === 'jmx_exporter') {
      const parts: string[] = []
      if ('heap_avg' in parsed) parts.push(`Heap avg ${parsed.heap_avg.toFixed(1)}%`)
      if ('gc_count' in parsed) parts.push(`GC ${parsed.gc_count}회`)
      return parts.join(' | ')
    }
    return Object.entries(parsed).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' | ')
  } catch {
    return '-'
  }
}

export function formatPeriodLabel(periodType: ReportType, startDate: string, endDate?: string): string {
  const d = new Date(startDate)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  if (periodType === 'daily') {
    const days = ['일', '월', '화', '수', '목', '금', '토']
    return `${kst.toISOString().slice(0, 10).replace(/-/g, '.')} (${days[kst.getDay()]})`
  }
  if (periodType === 'weekly' && endDate) {
    const e = new Date(new Date(endDate).getTime() + 9 * 60 * 60 * 1000)
    return `${kst.toISOString().slice(0, 10).replace(/-/g, '.')} ~ ${e.toISOString().slice(0, 10).replace(/-/g, '.')}`
  }
  if (periodType === 'monthly') {
    return `${kst.getFullYear()}년 ${kst.getMonth() + 1}월`
  }
  if (periodType === 'quarterly') {
    const q = Math.ceil((kst.getMonth() + 1) / 3)
    return `${kst.getFullYear()}년 ${q}분기`
  }
  if (periodType === 'half_year') {
    const half = kst.getMonth() < 6 ? '상반기' : '하반기'
    return `${kst.getFullYear()}년 ${half}`
  }
  return `${kst.getFullYear()}년`
}

export function llmSeverityToCardSeverity(s: LlmSeverity | null): 'normal' | 'warning' | 'critical' {
  if (s === 'warning') return 'warning'
  if (s === 'critical') return 'critical'
  return 'normal'
}
