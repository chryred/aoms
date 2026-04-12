import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  cn,
  formatKST,
  formatRelative,
  severityColor,
  anomalyColor,
  summarizeMetrics,
  formatPeriodLabel,
  llmSeverityToCardSeverity,
} from '@/lib/utils'

describe('cn', () => {
  it('단순 클래스 병합', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('조건부 클래스 처리', () => {
    expect(cn('a', (false as boolean) && 'b', 'c')).toBe('a c')
  })

  it('tailwind merge — 충돌 해결', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('undefined/null 무시', () => {
    expect(cn(undefined, null, 'a')).toBe('a')
  })
})

describe('formatKST', () => {
  it('datetime 포맷 (기본)', () => {
    const result = formatKST('2024-01-01T00:00:00Z')
    expect(result).toBe('2024-01-01 09:00')
  })

  it('date 포맷', () => {
    expect(formatKST('2024-01-01T00:00:00Z', 'date')).toBe('2024-01-01')
  })

  it('HH:mm 포맷', () => {
    expect(formatKST('2024-01-01T00:00:00Z', 'HH:mm')).toBe('09:00')
  })

  it('HH:mm:ss 포맷', () => {
    expect(formatKST('2024-01-01T00:00:00Z', 'HH:mm:ss')).toBe('09:00:00')
  })

  it('Date 객체 입력', () => {
    const d = new Date('2024-01-01T00:00:00Z')
    const result = formatKST(d)
    expect(result).toBe('2024-01-01 09:00')
  })
})

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('방금 전 (30초 이내)', () => {
    vi.setSystemTime(new Date('2024-01-01T10:00:30Z'))
    expect(formatRelative('2024-01-01T10:00:00Z')).toBe('방금 전')
  })

  it('N분 전', () => {
    vi.setSystemTime(new Date('2024-01-01T10:05:00Z'))
    expect(formatRelative('2024-01-01T10:00:00Z')).toBe('5분 전')
  })

  it('N시간 전', () => {
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'))
    expect(formatRelative('2024-01-01T10:00:00Z')).toBe('2시간 전')
  })

  it('1일 이상 — KST 날짜 반환', () => {
    vi.setSystemTime(new Date('2024-01-03T10:00:00Z'))
    const result = formatRelative('2024-01-01T10:00:00Z')
    expect(result).toBe('2024-01-01')
  })
})

describe('severityColor', () => {
  it('critical', () => {
    expect(severityColor('critical')).toBe('text-[#EF4444]')
  })

  it('warning', () => {
    expect(severityColor('warning')).toBe('text-[#F59E0B]')
  })

  it('그 외 (normal 등)', () => {
    expect(severityColor('normal')).toBe('text-[#22C55E]')
    expect(severityColor('info')).toBe('text-[#22C55E]')
  })
})

describe('anomalyColor', () => {
  it('duplicate', () => {
    expect(anomalyColor('duplicate')).toContain('text-[#8B97AD]')
  })

  it('recurring', () => {
    expect(anomalyColor('recurring')).toContain('text-[#F87171]')
  })

  it('related', () => {
    expect(anomalyColor('related')).toContain('text-[#FCD34D]')
  })

  it('null (new/default)', () => {
    expect(anomalyColor(null)).toContain('text-[#00D4FF]')
  })

  it('new', () => {
    expect(anomalyColor('new')).toContain('text-[#00D4FF]')
  })
})

describe('summarizeMetrics', () => {
  it('첫 3개 키:값 반환', () => {
    const json = JSON.stringify({ cpu_avg: 55.123, mem_used_pct: 70.5, disk_read_mb: 30.0 })
    const result = summarizeMetrics(json, 'synapse_agent')
    expect(result).toContain('cpu_avg: 55.123')
    expect(result).toContain('mem_used_pct: 70.5')
    expect(result).toContain('disk_read_mb: 30')
  })

  it('3개 초과 시 첫 3개만 반환', () => {
    const json = JSON.stringify({ a: 1, b: 2, c: 3, d: 4 })
    const result = summarizeMetrics(json)
    expect(result).toContain('a: 1')
    expect(result).toContain('b: 2')
    expect(result).toContain('c: 3')
    expect(result).not.toContain('d: 4')
  })

  it('잘못된 JSON — "-" 반환', () => {
    expect(summarizeMetrics('not-json')).toBe('-')
  })
})

describe('formatPeriodLabel', () => {
  it('daily — 날짜(요일) 형식', () => {
    // 2024-01-01은 월요일 (KST: 2024-01-01)
    const result = formatPeriodLabel('daily', '2024-01-01T00:00:00Z')
    expect(result).toMatch(/2024\.01\.01/)
    expect(result).toMatch(/[일월화수목금토]/)
  })

  it('weekly — 시작~종료 날짜', () => {
    const result = formatPeriodLabel('weekly', '2024-01-01T00:00:00Z', '2024-01-07T00:00:00Z')
    expect(result).toContain('~')
  })

  it('monthly — 년 N월', () => {
    const result = formatPeriodLabel('monthly', '2024-03-01T00:00:00Z')
    expect(result).toContain('2024년')
    expect(result).toContain('월')
  })

  it('quarterly — 년 N분기', () => {
    const result = formatPeriodLabel('quarterly', '2024-07-01T00:00:00Z')
    expect(result).toContain('분기')
  })

  it('half_year — 상/하반기', () => {
    const upper = formatPeriodLabel('half_year', '2024-01-01T00:00:00Z')
    expect(upper).toContain('상반기')
    const lower = formatPeriodLabel('half_year', '2024-07-01T00:00:00Z')
    expect(lower).toContain('하반기')
  })

  it('annual — 연도만', () => {
    const result = formatPeriodLabel('annual', '2024-01-01T00:00:00Z')
    expect(result).toBe('2024년')
  })
})

describe('llmSeverityToCardSeverity', () => {
  it('warning', () => {
    expect(llmSeverityToCardSeverity('warning')).toBe('warning')
  })

  it('critical', () => {
    expect(llmSeverityToCardSeverity('critical')).toBe('critical')
  })

  it('null → normal', () => {
    expect(llmSeverityToCardSeverity(null)).toBe('normal')
  })

  it('normal → normal', () => {
    expect(llmSeverityToCardSeverity('normal')).toBe('normal')
  })
})
