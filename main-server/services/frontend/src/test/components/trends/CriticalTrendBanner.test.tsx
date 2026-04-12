import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CriticalTrendBanner } from '@/components/trends/CriticalTrendBanner'

describe('CriticalTrendBanner', () => {
  it('count=0 → 미렌더링', () => {
    render(<CriticalTrendBanner count={0} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('count>0 → 렌더링', () => {
    render(<CriticalTrendBanner count={3} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('건수 표시', () => {
    render(<CriticalTrendBanner count={5} />)
    expect(screen.getByText(/5건/)).toBeInTheDocument()
  })

  it('경고 메시지 포함', () => {
    render(<CriticalTrendBanner count={1} />)
    expect(screen.getByText(/즉시 확인이 필요합니다/)).toBeInTheDocument()
  })
})
