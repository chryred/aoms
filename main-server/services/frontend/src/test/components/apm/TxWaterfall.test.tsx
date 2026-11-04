import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { TxCallTreeTab } from '@/components/apm/detail/TxCallTreeTab'
import { TxPathTab } from '@/components/apm/detail/TxPathTab'
import type { TxNode, TxSummary } from '@/types/apm'

const nodes: TxNode[] = [
  { i: 0, p: -1, k: 'http', n: 'GET /a', s: 0, d: 1000, sql_id: '' },
  { i: 1, p: 0, k: 'sql', n: 'slowSql', s: 100, d: 600, sql_id: 'q1' },
  { i: 2, p: 0, k: 'sql', n: 'tinySql', s: 800, d: 1, sql_id: 'q2' },
]

describe('TxCallTreeTab 워터폴', () => {
  it('눈금 5개와 행마다 얇은 막대를 그리고, 30% 이상은 경고 강조한다', () => {
    render(<TxCallTreeTab nodes={nodes} totalMs={1000} />)
    expect(screen.getAllByTestId('tick-label').map((e) => e.textContent)).toEqual([
      '0',
      '250',
      '500',
      '750',
      '1,000',
    ])
    const rows = screen.getAllByTestId('call-row')
    const bars = screen.getAllByTestId('call-bar')
    expect(bars.length).toBe(rows.length)
    const slow = bars.filter((b) => b.dataset.slow === 'true')
    expect(slow).toHaveLength(1)
    expect(
      within(rows.find((r) => r.textContent?.includes('slowSql'))!).getByText('60.0%'),
    ).toBeInTheDocument()
  })

  it('막대는 시작 오프셋·길이를 % 로 배치한다', () => {
    render(<TxCallTreeTab nodes={nodes} totalMs={1000} />)
    const bar = screen
      .getAllByTestId('call-row')
      .find((r) => r.textContent?.includes('slowSql'))!
      .querySelector<HTMLElement>('[data-testid="call-bar"]')!
    expect(bar.style.left).toBe('10%')
    expect(bar.style.width).toBe('60%')
  })
})

const mk = (over: Partial<TxSummary>): TxSummary =>
  ({
    trace_id: 't1',
    span_id: 's1',
    start_ts: '2026-10-30T01:00:00',
    uri: '/order/{n}',
    error: 0,
    elapsed_ms: 1000,
    sql_ms: 300,
    ext_ms: 200,
    system_name: 'payment',
    instance_role: 'was2',
    ...over,
  }) as TxSummary

describe('TxPathTab 시간축', () => {
  it('행이 1개여도 구간(AP/SQL/Remote)과 범례를 표시한다', () => {
    const cur = mk({})
    render(
      <MemoryRouter>
        <TxPathTab path={[cur]} current={cur} />
      </MemoryRouter>,
    )
    const row = screen.getByTestId('path-row')
    expect(row).toHaveAttribute('data-current', 'true')
    expect(row).toHaveTextContent('payment · was2')
    expect(row.querySelectorAll('[data-seg]')).toHaveLength(3)
    expect(screen.getByText('Remote')).toBeInTheDocument()
    expect(screen.getByTestId('path-timeline')).toHaveTextContent('10:00:00.000')
  })

  it('현재 건이 아닌 행은 current 표시가 없다', () => {
    const cur = mk({})
    const other = mk({ span_id: 's2', start_ts: '2026-10-30T01:00:00.200', elapsed_ms: 300 })
    render(
      <MemoryRouter>
        <TxPathTab path={[cur, other]} current={cur} />
      </MemoryRouter>,
    )
    const rows = screen.getAllByTestId('path-row')
    expect(rows[1]).not.toHaveAttribute('data-current')
  })
})
