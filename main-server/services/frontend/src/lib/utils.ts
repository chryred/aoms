import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { AnomalyType, Severity } from '@/types/alert'
import type { LlmSeverity } from '@/types/aggregation'
import type { ReportType } from '@/types/report'
import type { AgentType } from '@/types/agent'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// naive UTC 문자열(타임존 접미사 Z/+/- 없음)에 'Z'를 부착해 UTC로 강제 해석.
// 이미 Z 또는 ±HH:MM suffix가 있으면 그대로 반환. new Date(...) 호출 전에 사용.
export function normalizeUtc(utcDate: string): string {
  return !utcDate.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(utcDate) ? utcDate + 'Z' : utcDate
}

// KST 날짜피커 입력(YYYY-MM-DD) → 백엔드 naive UTC ISO 문자열.
// 사용자가 고른 KST 자정(00:00) / 하루 끝(23:59:59)을 UTC로 환산해 필터 쿼리에 사용.
// 예: "2026-04-21" (KST) → start "2026-04-20T15:00:00", end "2026-04-21T14:59:59"
export const kstDateToUtcStart = (d: string) =>
  new Date(d + 'T00:00:00+09:00').toISOString().replace('.000Z', '')
export const kstDateToUtcEnd = (d: string) =>
  new Date(d + 'T23:59:59+09:00').toISOString().replace('.000Z', '')

// UTC → KST (UTC+9) 변환
export function formatKST(
  utcDate: string | Date,
  format: 'datetime' | 'date' | 'HH:mm' | 'HH:mm:ss' = 'datetime',
): string {
  const normalized = typeof utcDate === 'string' ? normalizeUtc(utcDate) : utcDate
  const d = new Date(normalized)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  if (format === 'HH:mm:ss') return kst.toISOString().slice(11, 19)
  if (format === 'HH:mm') return kst.toISOString().slice(11, 16)
  if (format === 'date') return kst.toISOString().slice(0, 10)
  return kst.toISOString().slice(0, 16).replace('T', ' ')
}

// 상대 시간 (1시간 이내: "3분 전", 7일 이내: "N시간/일 전", 이상: KST 절대)
export function formatRelative(utcDate: string): string {
  const diff = Date.now() - new Date(normalizeUtc(utcDate)).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return '방금 전'
  if (mins < 60) return `${mins}분 전`
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(diff / 86_400_000)
  if (days < 7) return `${days}일 전`
  return formatKST(utcDate, 'date')
}

export function severityColor(severity: Severity | string): string {
  switch (severity) {
    case 'critical':
      return 'text-critical'
    case 'warning':
      return 'text-warning'
    default:
      return 'text-normal'
  }
}

export function anomalyColor(type: AnomalyType | null): string {
  switch (type) {
    case 'duplicate':
      return 'bg-hover-subtle text-text-secondary border-border'
    case 'recurring':
      return 'bg-critical-bg text-critical-text border-critical-border'
    case 'related':
      return 'bg-warning-bg text-warning-text border-warning-border'
    default:
      return 'bg-accent-muted text-accent border-accent/20'
  }
}

// 에이전트 타입 라벨 (공통)
export const AGENT_TYPE_LABEL: Record<AgentType, string> = {
  synapse_agent: 'Synapse 수집기',
  db: 'DB 수집기',
  otel_javaagent: 'OTel Java 수집기',
}

// DB 타입 라벨
import type { DbType } from '@/types/agent'
export const DB_TYPE_LABEL: Record<DbType, string> = {
  oracle: 'Oracle',
  postgresql: 'PostgreSQL',
  mssql: 'MSSQL',
  mysql: 'MySQL',
}

export function getAgentTypeLabel(type: string): string {
  return AGENT_TYPE_LABEL[type as AgentType] ?? type
}

export function summarizeMetrics(
  metricsJson: string,
  _collectorType?: string,
): { key: string; value: string }[] {
  try {
    const parsed = JSON.parse(metricsJson) as Record<string, number>
    return Object.entries(parsed)
      .slice(0, 3)
      .map(([k, v]) => ({ key: k, value: String(v) }))
  } catch {
    return []
  }
}

export function formatPeriodLabel(
  periodType: ReportType,
  startDate: string,
  endDate?: string,
): string {
  const kstStr = formatKST(startDate, 'date') // YYYY-MM-DD already in KST
  const [yearNum, monthNum] = kstStr.split('-').map(Number)
  const kstDate = new Date(kstStr + 'T00:00:00+09:00')

  if (periodType === 'daily') {
    const days = ['일', '월', '화', '수', '목', '금', '토']
    return `${kstStr.replace(/-/g, '.')} (${days[kstDate.getDay()]})`
  }
  if (periodType === 'weekly' && endDate) {
    const endKstStr = formatKST(endDate, 'date')
    return `${kstStr.replace(/-/g, '.')} ~ ${endKstStr.replace(/-/g, '.')}`
  }
  if (periodType === 'monthly') {
    return `${yearNum}년 ${monthNum}월`
  }
  if (periodType === 'quarterly') {
    const q = Math.ceil(monthNum / 3)
    return `${yearNum}년 ${q}분기`
  }
  if (periodType === 'half_year') {
    return `${yearNum}년 ${monthNum <= 6 ? '상반기' : '하반기'}`
  }
  return `${yearNum}년`
}

export function llmSeverityToCardSeverity(
  s: LlmSeverity | null,
): 'normal' | 'warning' | 'critical' {
  if (s === 'warning') return 'warning'
  if (s === 'critical') return 'critical'
  return 'normal'
}
