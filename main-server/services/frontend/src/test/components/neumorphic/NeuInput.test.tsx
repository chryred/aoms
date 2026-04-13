import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { Search } from 'lucide-react'

describe('NeuInput', () => {
  it('기본 렌더링', () => {
    render(<NeuInput />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('label 렌더링', () => {
    render(<NeuInput id="test" label="이름" />)
    expect(screen.getByLabelText('이름')).toBeInTheDocument()
  })

  it('label 없을 때 미렌더링', () => {
    render(<NeuInput />)
    expect(screen.queryByText('이름')).toBeNull()
  })

  it('error 메시지 렌더링', () => {
    render(<NeuInput error="필수 입력" />)
    expect(screen.getByText('필수 입력')).toBeInTheDocument()
  })

  it('error 있을 때 border 색상 변경', () => {
    render(<NeuInput error="오류" />)
    const input = screen.getByRole('textbox')
    expect(input.className).toContain('border-critical')
  })

  it('leftIcon 렌더링', () => {
    const { container } = render(<NeuInput leftIcon={<Search data-testid="icon" />} />)
    expect(container.querySelector('[data-testid="icon"]')).toBeInTheDocument()
  })

  it('leftIcon 있을 때 패딩 추가', () => {
    render(<NeuInput leftIcon={<Search />} />)
    expect(screen.getByRole('textbox').className).toContain('pl-10')
  })

  it('placeholder 표시', () => {
    render(<NeuInput placeholder="검색어 입력" />)
    expect(screen.getByPlaceholderText('검색어 입력')).toBeInTheDocument()
  })

  it('disabled 상태', () => {
    render(<NeuInput disabled />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('onChange 이벤트', async () => {
    const handler = vi.fn()
    render(<NeuInput onChange={handler} />)
    await userEvent.type(screen.getByRole('textbox'), 'hello')
    expect(handler).toHaveBeenCalled()
  })

  it('displayName 설정', () => {
    expect(NeuInput.displayName).toBe('NeuInput')
  })
})
