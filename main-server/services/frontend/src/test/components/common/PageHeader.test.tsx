import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from '@/components/common/PageHeader'

describe('PageHeader', () => {
  it('title 렌더링', () => {
    render(<PageHeader title="시스템 목록" />)
    expect(screen.getByRole('heading', { name: '시스템 목록' })).toBeInTheDocument()
  })

  it('description 렌더링', () => {
    render(<PageHeader title="제목" description="설명 텍스트" />)
    expect(screen.getByText('설명 텍스트')).toBeInTheDocument()
  })

  it('description 없을 때 미렌더링', () => {
    render(<PageHeader title="제목" />)
    expect(screen.queryByText('설명 텍스트')).toBeNull()
  })

  it('action 렌더링', () => {
    render(<PageHeader title="제목" action={<button>추가</button>} />)
    expect(screen.getByRole('button', { name: '추가' })).toBeInTheDocument()
  })

  it('action 없을 때 미렌더링', () => {
    render(<PageHeader title="제목" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
