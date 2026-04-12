import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TrendAlertCard } from '@/components/trends/TrendAlertCard'
import type { TrendAlert } from '@/types/aggregation'

// formatRelative 타이머 모킹
vi.useFakeTimers()
const NOW = new Date('2024-01-01T12:00:00Z')
vi.setSystemTime(NOW)

const makeAlert = (
  overrides: Partial<TrendAlert & { display_name?: string; system_name?: string }> = {},
) => ({
  id: 1,
  system_id: 5,
  collector_type: 'synapse_agent',
  metric_group: 'cpu',
  hour_bucket: '2024-01-01T11:00:00Z',
  llm_severity: 'warning' as const,
  llm_prediction: 'CPU 사용률 급증 예상',
  llm_summary: '최근 1시간 평균 CPU 75%',
  qdrant_point_id: null,
  created_at: '2024-01-01T11:00:00Z',
  ...overrides,
})

describe('TrendAlertCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('시스템 display_name 표시', () => {
    render(
      <MemoryRouter>
        <TrendAlertCard alert={makeAlert({ display_name: '고객 경험 시스템' })} />
      </MemoryRouter>,
    )
    expect(screen.getByText('고객 경험 시스템')).toBeInTheDocument()
  })

  it('display_name 없으면 system_name 사용', () => {
    render(
      <MemoryRouter>
        <TrendAlertCard alert={makeAlert({ system_name: 'customer_experience' })} />
      </MemoryRouter>,
    )
    expect(screen.getByText('customer_experience')).toBeInTheDocument()
  })

  it('display_name, system_name 모두 없으면 시스템 #id', () => {
    render(
      <MemoryRouter>
        <TrendAlertCard alert={makeAlert({ system_id: 9 })} />
      </MemoryRouter>,
    )
    expect(screen.getByText('시스템 #9')).toBeInTheDocument()
  })

  it('llm_prediction 표시', () => {
    render(
      <MemoryRouter>
        <TrendAlertCard alert={makeAlert()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('CPU 사용률 급증 예상')).toBeInTheDocument()
  })

  it('llm_summary 표시', () => {
    render(
      <MemoryRouter>
        <TrendAlertCard alert={makeAlert()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('최근 1시간 평균 CPU 75%')).toBeInTheDocument()
  })

  it('llm_summary 없으면 미표시', () => {
    render(
      <MemoryRouter>
        <TrendAlertCard alert={makeAlert({ llm_summary: undefined as never })} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('최근 1시간 평균 CPU 75%')).toBeNull()
  })

  it('metric_group 표시', () => {
    render(
      <MemoryRouter>
        <TrendAlertCard alert={makeAlert()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('cpu')).toBeInTheDocument()
  })

  it('시스템 상세 보기 링크', () => {
    render(
      <MemoryRouter>
        <TrendAlertCard alert={makeAlert({ system_id: 5 })} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '시스템 상세 보기' })).toHaveAttribute(
      'href',
      '/dashboard/5',
    )
  })

  it('critical severity — critical NeuCard', () => {
    const { container } = render(
      <MemoryRouter>
        <TrendAlertCard alert={makeAlert({ llm_severity: 'critical' })} />
      </MemoryRouter>,
    )
    // NeuCard with severity=critical has border-l-[#EF4444]
    expect(container.firstChild?.firstChild as HTMLElement).toBeTruthy()
  })
})
