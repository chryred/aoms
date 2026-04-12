import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from '@/components/common/EmptyState'
import { Inbox } from 'lucide-react'

describe('EmptyState', () => {
  it('title 렌더링', () => {
    render(<EmptyState icon={<Inbox />} title="데이터 없음" />)
    expect(screen.getByText('데이터 없음')).toBeInTheDocument()
  })

  it('description 렌더링', () => {
    render(<EmptyState icon={<Inbox />} title="없음" description="항목이 없습니다" />)
    expect(screen.getByText('항목이 없습니다')).toBeInTheDocument()
  })

  it('description 없을 때 미렌더링', () => {
    render(<EmptyState icon={<Inbox />} title="없음" />)
    expect(screen.queryByText('항목이 없습니다')).toBeNull()
  })

  it('cta 버튼 렌더링', () => {
    render(<EmptyState icon={<Inbox />} title="없음" cta={{ label: '추가', onClick: vi.fn() }} />)
    expect(screen.getByRole('button', { name: '추가' })).toBeInTheDocument()
  })

  it('cta 없을 때 버튼 미렌더링', () => {
    render(<EmptyState icon={<Inbox />} title="없음" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('cta onClick 호출', async () => {
    const handler = vi.fn()
    render(<EmptyState icon={<Inbox />} title="없음" cta={{ label: '클릭', onClick: handler }} />)
    await userEvent.click(screen.getByRole('button'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('icon 렌더링', () => {
    const { container } = render(<EmptyState icon={<span data-testid="icon" />} title="없음" />)
    expect(container.querySelector('[data-testid="icon"]')).toBeInTheDocument()
  })
})
