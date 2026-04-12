import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NeuButton } from '@/components/neumorphic/NeuButton'

describe('NeuButton', () => {
  it('children 렌더링', () => {
    render(<NeuButton>클릭</NeuButton>)
    expect(screen.getByRole('button', { name: '클릭' })).toBeInTheDocument()
  })

  it('기본 variant=primary 클래스', () => {
    render(<NeuButton>버튼</NeuButton>)
    const btn = screen.getByRole('button')
    expect(btn).toHaveClass('bg-[#00D4FF]')
  })

  it('variant=secondary', () => {
    render(<NeuButton variant="secondary">버튼</NeuButton>)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('text-[#E2E8F2]')
  })

  it('variant=glass', () => {
    render(<NeuButton variant="glass">버튼</NeuButton>)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('text-[#00D4FF]')
  })

  it('variant=ghost', () => {
    render(<NeuButton variant="ghost">버튼</NeuButton>)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('text-[#8B97AD]')
  })

  it('variant=danger', () => {
    render(<NeuButton variant="danger">버튼</NeuButton>)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('bg-[#EF4444]')
  })

  it('size=sm', () => {
    render(<NeuButton size="sm">버튼</NeuButton>)
    expect(screen.getByRole('button').className).toContain('px-3')
  })

  it('size=lg', () => {
    render(<NeuButton size="lg">버튼</NeuButton>)
    expect(screen.getByRole('button').className).toContain('px-6')
  })

  it('loading=true — 스피너 표시 + disabled', () => {
    render(<NeuButton loading>버튼</NeuButton>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    // Loader2 아이콘이 렌더링됨 (SVG)
    expect(btn.querySelector('svg')).toBeInTheDocument()
  })

  it('disabled prop', () => {
    render(<NeuButton disabled>버튼</NeuButton>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('onClick 핸들러 호출', async () => {
    const handler = vi.fn()
    render(<NeuButton onClick={handler}>클릭</NeuButton>)
    await userEvent.click(screen.getByRole('button'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('disabled일 때 클릭 방지', async () => {
    const handler = vi.fn()
    render(
      <NeuButton disabled onClick={handler}>
        클릭
      </NeuButton>,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(handler).not.toHaveBeenCalled()
  })

  it('className 병합', () => {
    render(<NeuButton className="my-custom-class">버튼</NeuButton>)
    expect(screen.getByRole('button').className).toContain('my-custom-class')
  })
})
