import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeuCard } from '@/components/neumorphic/NeuCard'

describe('NeuCard', () => {
  it('children 렌더링', () => {
    render(<NeuCard>카드 내용</NeuCard>)
    expect(screen.getByText('카드 내용')).toBeInTheDocument()
  })

  it('기본 스타일', () => {
    const { container } = render(<NeuCard>내용</NeuCard>)
    const card = container.firstChild as HTMLElement
    expect(card.className).toContain('bg-bg-base')
  })

  it('severity=critical — glow shadow 적용', () => {
    const { container } = render(<NeuCard severity="critical">내용</NeuCard>)
    const card = container.firstChild as HTMLElement
    expect(card.className).toContain('shadow-glow-critical')
  })

  it('severity=warning — glow shadow 적용', () => {
    const { container } = render(<NeuCard severity="warning">내용</NeuCard>)
    const card = container.firstChild as HTMLElement
    expect(card.className).toContain('shadow-glow-warning')
  })

  it('pressed=true — inset shadow', () => {
    const { container } = render(<NeuCard pressed>내용</NeuCard>)
    const card = container.firstChild as HTMLElement
    expect(card.className).toContain('inset')
  })

  it('onClick 없을 때 role/tabIndex 없음', () => {
    const { container } = render(<NeuCard>내용</NeuCard>)
    const card = container.firstChild as HTMLElement
    expect(card.getAttribute('role')).toBeNull()
    expect(card.getAttribute('tabindex')).toBeNull()
  })

  it('onClick 있을 때 role=button, tabIndex=0', () => {
    render(<NeuCard onClick={() => {}}>내용</NeuCard>)
    const card = screen.getByRole('button')
    expect(card).toBeInTheDocument()
    expect(card.getAttribute('tabindex')).toBe('0')
  })

  it('onClick 호출', async () => {
    const handler = vi.fn()
    render(<NeuCard onClick={handler}>내용</NeuCard>)
    await userEvent.click(screen.getByRole('button'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('Enter 키로 onClick 호출', async () => {
    const handler = vi.fn()
    render(<NeuCard onClick={handler}>내용</NeuCard>)
    screen.getByRole('button').focus()
    await userEvent.keyboard('{Enter}')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('Space 키로 onClick 호출', async () => {
    const handler = vi.fn()
    render(<NeuCard onClick={handler}>내용</NeuCard>)
    screen.getByRole('button').focus()
    await userEvent.keyboard(' ')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('className 병합', () => {
    const { container } = render(<NeuCard className="extra-class">내용</NeuCard>)
    expect((container.firstChild as HTMLElement).className).toContain('extra-class')
  })
})
