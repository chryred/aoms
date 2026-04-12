import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SimilarResultCard } from '@/components/search/SimilarResultCard'
import type { SimilarSearchResult } from '@/types/search'

const hourlyResult: SimilarSearchResult = {
  score: 0.92,
  payload: {
    system_id: 1,
    system_name: '주문 시스템',
    collector_type: 'synapse_agent',
    metric_group: 'cpu',
    hour_bucket: '2024-01-01T10:00:00Z',
    llm_severity: 'warning',
    summary_text: 'CPU 80% 초과 이상 패턴',
    llm_prediction: '이후 1시간 내 장애 가능성',
  },
}

const aggResult: SimilarSearchResult = {
  score: 0.78,
  payload: {
    system_id: 2,
    system_name: '재고 시스템',
    period_type: 'daily',
    period_start: '2024-01-01T00:00:00Z',
    dominant_severity: 'critical',
    summary_text: '하루 평균 에러율 5%',
  },
}

describe('SimilarResultCard — hourly pattern', () => {
  it('유사도 표시', () => {
    render(
      <MemoryRouter>
        <SimilarResultCard result={hourlyResult} collection="metric_hourly_patterns" />
      </MemoryRouter>,
    )
    expect(screen.getByText(/92\.0%/)).toBeInTheDocument()
  })

  it('시스템명 표시', () => {
    render(
      <MemoryRouter>
        <SimilarResultCard result={hourlyResult} collection="metric_hourly_patterns" />
      </MemoryRouter>,
    )
    expect(screen.getByText('주문 시스템')).toBeInTheDocument()
  })

  it('summary_text 표시', () => {
    render(
      <MemoryRouter>
        <SimilarResultCard result={hourlyResult} collection="metric_hourly_patterns" />
      </MemoryRouter>,
    )
    expect(screen.getByText('CPU 80% 초과 이상 패턴')).toBeInTheDocument()
  })

  it('llm_prediction 표시 (hourly only)', () => {
    render(
      <MemoryRouter>
        <SimilarResultCard result={hourlyResult} collection="metric_hourly_patterns" />
      </MemoryRouter>,
    )
    expect(screen.getByText('이후 1시간 내 장애 가능성')).toBeInTheDocument()
  })

  it('metric_group 배지 표시 (hourly only)', () => {
    render(
      <MemoryRouter>
        <SimilarResultCard result={hourlyResult} collection="metric_hourly_patterns" />
      </MemoryRouter>,
    )
    expect(screen.getByText('cpu')).toBeInTheDocument()
  })

  it('관련 알림 이력 링크', () => {
    render(
      <MemoryRouter>
        <SimilarResultCard result={hourlyResult} collection="metric_hourly_patterns" />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: '관련 알림 이력' })
    expect(link.getAttribute('href')).toContain('/alerts')
  })
})

describe('SimilarResultCard — aggregation summary', () => {
  it('유사도 낮음 — 노란 클래스', () => {
    render(
      <MemoryRouter>
        <SimilarResultCard result={aggResult} collection="aggregation_summaries" />
      </MemoryRouter>,
    )
    expect(screen.getByText(/78\.0%/)).toBeInTheDocument()
  })

  it('시스템명 표시', () => {
    render(
      <MemoryRouter>
        <SimilarResultCard result={aggResult} collection="aggregation_summaries" />
      </MemoryRouter>,
    )
    expect(screen.getByText('재고 시스템')).toBeInTheDocument()
  })

  it('hourly 전용 요소 미표시 (aggregation)', () => {
    render(
      <MemoryRouter>
        <SimilarResultCard result={aggResult} collection="aggregation_summaries" />
      </MemoryRouter>,
    )
    // metric_group 배지 없음
    expect(screen.queryByText('cpu')).toBeNull()
  })
})
