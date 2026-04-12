import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorCard } from '@/components/common/ErrorCard'

describe('ErrorCard', () => {
  it('기본 메시지 렌더링', () => {
    render(<ErrorCard />)
    expect(screen.getByText('데이터를 불러오지 못했습니다')).toBeInTheDocument()
  })

  it('커스텀 메시지', () => {
    render(<ErrorCard message="서버 오류 발생" />)
    expect(screen.getByText('서버 오류 발생')).toBeInTheDocument()
  })

  it('onRetry 버튼 렌더링', () => {
    render(<ErrorCard onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  it('onRetry 없을 때 버튼 미렌더링', () => {
    render(<ErrorCard />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('onRetry 클릭', async () => {
    const handler = vi.fn()
    render(<ErrorCard onRetry={handler} />)
    await userEvent.click(screen.getByRole('button'))
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
