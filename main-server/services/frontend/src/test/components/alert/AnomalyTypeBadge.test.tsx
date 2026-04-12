import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnomalyTypeBadge } from '@/components/alert/AnomalyTypeBadge'

describe('AnomalyTypeBadge', () => {
  it('type=null → null 반환', () => {
    const { container } = render(<AnomalyTypeBadge type={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('type=new — 신규 표시', () => {
    render(<AnomalyTypeBadge type="new" />)
    expect(screen.getByText('신규')).toBeInTheDocument()
  })

  it('type=related — 유사 표시', () => {
    render(<AnomalyTypeBadge type="related" />)
    expect(screen.getByText('유사')).toBeInTheDocument()
  })

  it('type=recurring — 반복 표시', () => {
    render(<AnomalyTypeBadge type="recurring" />)
    expect(screen.getByText('반복')).toBeInTheDocument()
  })

  it('type=duplicate — 중복 표시', () => {
    render(<AnomalyTypeBadge type="duplicate" />)
    expect(screen.getByText('중복')).toBeInTheDocument()
  })

  it('score 표시 (반올림)', () => {
    render(<AnomalyTypeBadge type="related" score={0.875} />)
    expect(screen.getByText('(88%)')).toBeInTheDocument()
  })

  it('score=null일 때 미표시', () => {
    render(<AnomalyTypeBadge type="new" score={null} />)
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('score=undefined일 때 미표시', () => {
    render(<AnomalyTypeBadge type="new" />)
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('recurring — 빨간 텍스트 클래스', () => {
    render(<AnomalyTypeBadge type="recurring" />)
    expect(screen.getByText('반복').className).toContain('text-[#F87171]')
  })

  it('duplicate — muted 텍스트 클래스', () => {
    render(<AnomalyTypeBadge type="duplicate" />)
    expect(screen.getByText('중복').className).toContain('text-[#8B97AD]')
  })
})
