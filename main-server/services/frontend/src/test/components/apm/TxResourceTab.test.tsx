import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TxResourceTab } from '@/components/apm/detail/TxResourceTab'
import { timeComposition } from '@/lib/apm/resourceStats'
import type { TxSummary } from '@/types/apm'

const mk = (over: Partial<TxSummary> = {}) =>
  ({
    elapsed_ms: 1000,
    cpu_ms: 50,
    sql_ms: 300,
    sql_cnt: 3,
    fetch_ms: 100,
    fetch_cnt: 20,
    ext_ms: 200,
    ext_cnt: 2,
    conn_open: 1,
    conn_close: 1,
    conn_leak: 0,
    conn_uncommit: 0,
    ...over,
  }) as TxSummary

describe('timeComposition', () => {
  it('기타 AP = elapsed − sql − fetch − ext, CPU 비율·SQL 평균', () => {
    const c = timeComposition(mk())
    expect(c.parts.find((p) => p.key === 'other')!.ms).toBe(400)
    expect(c.cpuPct).toBe(5)
    expect(c.sqlAvgMs).toBe(100)
  })
  it('합이 elapsed 를 넘으면 기타는 0 으로 자른다', () => {
    const c = timeComposition(mk({ elapsed_ms: 100 }))
    expect(c.parts.find((p) => p.key === 'other')!.ms).toBe(0)
  })
  it('SQL 0건이면 평균 0, elapsed 0 이면 CPU 비율 0', () => {
    const c = timeComposition(mk({ sql_cnt: 0, elapsed_ms: 0 }))
    expect(c.sqlAvgMs).toBe(0)
    expect(c.cpuPct).toBe(0)
  })
})

describe('TxResourceTab', () => {
  it('정상: 반환 완료 상태와 CPU 라인', () => {
    render(<TxResourceTab summary={mk()} />)
    expect(screen.getByTestId('conn-status')).toHaveAttribute('data-state', 'normal')
    expect(screen.getByTestId('cpu-line')).toHaveTextContent('CPU 50ms (전체의 5.0%)')
    expect(screen.getAllByTestId('time-legend')).toHaveLength(4)
    expect(screen.getByText(/총 300ms · 평균 100ms/)).toBeInTheDocument()
  })
  it('leak > 0 → critical + 설명', () => {
    render(<TxResourceTab summary={mk({ conn_leak: 2 })} />)
    expect(screen.getByTestId('conn-status')).toHaveAttribute('data-state', 'critical')
    expect(screen.getByTestId('conn-status')).toHaveTextContent('풀 고갈')
  })
  it('uncommit > 0 → warning', () => {
    render(<TxResourceTab summary={mk({ conn_uncommit: 1 })} />)
    expect(screen.getByTestId('conn-status')).toHaveAttribute('data-state', 'warning')
  })
  it('호출이 0건이면 "없음"', () => {
    render(<TxResourceTab summary={mk({ sql_cnt: 0, fetch_cnt: 0, ext_cnt: 0 })} />)
    expect(screen.getAllByText('없음')).toHaveLength(3)
  })
})
