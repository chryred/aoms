import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PeriodToggle } from '@/components/reports/PeriodToggle'

describe('PeriodToggle', () => {
  it('6개 기간 버튼 모두 렌더링', () => {
    render(<PeriodToggle value="daily" onChange={vi.fn()} />)
    expect(screen.getByText('일별')).toBeInTheDocument()
    expect(screen.getByText('주별')).toBeInTheDocument()
    expect(screen.getByText('월별')).toBeInTheDocument()
    expect(screen.getByText('분기')).toBeInTheDocument()
    expect(screen.getByText('반기')).toBeInTheDocument()
    expect(screen.getByText('연간')).toBeInTheDocument()
  })

  it('선택된 항목에 활성 클래스', () => {
    render(<PeriodToggle value="monthly" onChange={vi.fn()} />)
    const monthBtn = screen.getByText('월별')
    expect(monthBtn.className).toContain('border-b-2')
  })

  it('비활성 항목에 활성 클래스 없음', () => {
    render(<PeriodToggle value="daily" onChange={vi.fn()} />)
    const weekBtn = screen.getByText('주별')
    expect(weekBtn.className).not.toContain('border-b-2')
  })

  it('버튼 클릭 시 onChange 호출', async () => {
    const handler = vi.fn()
    render(<PeriodToggle value="daily" onChange={handler} />)
    await userEvent.click(screen.getByText('주별'))
    expect(handler).toHaveBeenCalledWith('weekly')
  })

  it('현재 선택 버튼 클릭 시에도 onChange 호출', async () => {
    const handler = vi.fn()
    render(<PeriodToggle value="daily" onChange={handler} />)
    await userEvent.click(screen.getByText('일별'))
    expect(handler).toHaveBeenCalledWith('daily')
  })

  it('quarterly 선택', async () => {
    const handler = vi.fn()
    render(<PeriodToggle value="daily" onChange={handler} />)
    await userEvent.click(screen.getByText('분기'))
    expect(handler).toHaveBeenCalledWith('quarterly')
  })

  it('half_year 선택', async () => {
    const handler = vi.fn()
    render(<PeriodToggle value="daily" onChange={handler} />)
    await userEvent.click(screen.getByText('반기'))
    expect(handler).toHaveBeenCalledWith('half_year')
  })

  it('annual 선택', async () => {
    const handler = vi.fn()
    render(<PeriodToggle value="daily" onChange={handler} />)
    await userEvent.click(screen.getByText('연간'))
    expect(handler).toHaveBeenCalledWith('annual')
  })
})
