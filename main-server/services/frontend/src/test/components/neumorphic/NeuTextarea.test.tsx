import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'

describe('NeuTextarea', () => {
  it('기본 렌더링', () => {
    render(<NeuTextarea />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('label 렌더링', () => {
    render(<NeuTextarea id="ta" label="메모" />)
    expect(screen.getByLabelText('메모')).toBeInTheDocument()
  })

  it('label 없을 때 미렌더링', () => {
    render(<NeuTextarea />)
    expect(screen.queryByText('메모')).toBeNull()
  })

  it('error 메시지 렌더링', () => {
    render(<NeuTextarea error="입력 오류" />)
    expect(screen.getByText('입력 오류')).toBeInTheDocument()
  })

  it('error 있을 때 border 색상', () => {
    render(<NeuTextarea error="오류" />)
    expect(screen.getByRole('textbox').className).toContain('border-critical')
  })

  it('disabled 상태', () => {
    render(<NeuTextarea disabled />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('placeholder', () => {
    render(<NeuTextarea placeholder="텍스트 입력" />)
    expect(screen.getByPlaceholderText('텍스트 입력')).toBeInTheDocument()
  })

  it('입력 이벤트', async () => {
    const handler = vi.fn()
    render(<NeuTextarea onChange={handler} />)
    await userEvent.type(screen.getByRole('textbox'), '내용')
    expect(handler).toHaveBeenCalled()
  })

  it('displayName 설정', () => {
    expect(NeuTextarea.displayName).toBe('NeuTextarea')
  })
})
