import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '@/components/user/ConfirmDialog'

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  title: '삭제 확인',
  description: '정말 삭제하시겠습니까?',
  confirmLabel: '삭제',
  onConfirm: vi.fn(),
}

describe('ConfirmDialog', () => {
  it('open=false 일 때 미렌더링', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('open=true 일 때 렌더링', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('title 렌더링', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByText('삭제 확인')).toBeInTheDocument()
  })

  it('description 렌더링', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByText('정말 삭제하시겠습니까?')).toBeInTheDocument()
  })

  it('confirmLabel 렌더링', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument()
  })

  it('취소 버튼 렌더링', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument()
  })

  it('취소 클릭 → onOpenChange(false)', async () => {
    const onOpenChange = vi.fn()
    render(<ConfirmDialog {...defaultProps} onOpenChange={onOpenChange} />)
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('확인 클릭 → onConfirm 호출', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('오버레이 클릭 → onOpenChange(false)', async () => {
    const onOpenChange = vi.fn()
    render(<ConfirmDialog {...defaultProps} onOpenChange={onOpenChange} />)
    // 오버레이는 aria-hidden div
    const overlay = document.querySelector('.bg-overlay') as HTMLElement
    await userEvent.click(overlay)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('isPending=true — 버튼 disabled', () => {
    render(<ConfirmDialog {...defaultProps} isPending />)
    const buttons = screen.getAllByRole('button')
    buttons.forEach((btn) => expect(btn).toBeDisabled())
  })

  it('confirmVariant=destructive — danger 스타일', () => {
    render(<ConfirmDialog {...defaultProps} confirmVariant="destructive" />)
    const confirmBtn = screen.getByRole('button', { name: '삭제' })
    expect(confirmBtn.className).toContain('bg-critical')
  })

  it('ESC 키 → onOpenChange(false)', async () => {
    const onOpenChange = vi.fn()
    render(<ConfirmDialog {...defaultProps} onOpenChange={onOpenChange} />)
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('isPending 중 ESC 키 무시', async () => {
    const onOpenChange = vi.fn()
    render(<ConfirmDialog {...defaultProps} onOpenChange={onOpenChange} isPending />)
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
