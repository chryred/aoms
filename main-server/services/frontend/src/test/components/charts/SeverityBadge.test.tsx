import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeverityBadge } from '@/components/charts/SeverityBadge'

describe('SeverityBadge', () => {
  it('normal — 정상', () => {
    render(<SeverityBadge severity="normal" />)
    expect(screen.getByText('정상')).toBeInTheDocument()
  })

  it('warning — 경고', () => {
    render(<SeverityBadge severity="warning" />)
    expect(screen.getByText('경고')).toBeInTheDocument()
  })

  it('critical — 위험', () => {
    render(<SeverityBadge severity="critical" />)
    expect(screen.getByText('위험')).toBeInTheDocument()
  })

  it('info — 정보', () => {
    render(<SeverityBadge severity="info" />)
    expect(screen.getByText('정보')).toBeInTheDocument()
  })

  it('알 수 없는 severity — fallback', () => {
    render(<SeverityBadge severity={'unknown' as never} />)
    expect(screen.getByText('unknown')).toBeInTheDocument()
  })

  it('size=sm — 기본', () => {
    render(<SeverityBadge severity="normal" />)
    expect(screen.getByText('정상').className).toContain('text-xs')
  })

  it('size=md', () => {
    render(<SeverityBadge severity="normal" size="md" />)
    expect(screen.getByText('정상').className).toContain('text-sm')
  })

  it('critical — 빨간 텍스트', () => {
    render(<SeverityBadge severity="critical" />)
    expect(screen.getByText('위험').className).toContain('text-critical-text')
  })

  it('normal — 초록 텍스트', () => {
    render(<SeverityBadge severity="normal" />)
    expect(screen.getByText('정상').className).toContain('text-normal')
  })
})
