import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'

describe('NeuBadge', () => {
  it('children 렌더링', () => {
    render(<NeuBadge>뱃지</NeuBadge>)
    expect(screen.getByText('뱃지')).toBeInTheDocument()
  })

  it('기본 variant=muted 클래스', () => {
    render(<NeuBadge>뱃지</NeuBadge>)
    expect(screen.getByText('뱃지').className).toContain('text-text-secondary')
  })

  it('variant=critical', () => {
    render(<NeuBadge variant="critical">위험</NeuBadge>)
    expect(screen.getByText('위험').className).toContain('text-critical-text')
  })

  it('variant=warning', () => {
    render(<NeuBadge variant="warning">경고</NeuBadge>)
    expect(screen.getByText('경고').className).toContain('text-warning-text')
  })

  it('variant=normal', () => {
    render(<NeuBadge variant="normal">정상</NeuBadge>)
    expect(screen.getByText('정상').className).toContain('text-normal-text')
  })

  it('variant=info', () => {
    render(<NeuBadge variant="info">정보</NeuBadge>)
    expect(screen.getByText('정보').className).toContain('text-accent')
  })

  it('className 병합', () => {
    render(<NeuBadge className="extra">뱃지</NeuBadge>)
    expect(screen.getByText('뱃지').className).toContain('extra')
  })

  it('rounded-full 클래스', () => {
    render(<NeuBadge>뱃지</NeuBadge>)
    expect(screen.getByText('뱃지').className).toContain('rounded-full')
  })
})
