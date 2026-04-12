import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UserStatusBadge, UserRoleBadge } from '@/components/user/UserStatusBadge'

describe('UserStatusBadge', () => {
  it('pending — 승인 대기', () => {
    render(<UserStatusBadge status="pending" />)
    expect(screen.getByText('승인 대기')).toBeInTheDocument()
  })

  it('active — 활성', () => {
    render(<UserStatusBadge status="active" />)
    expect(screen.getByText('활성')).toBeInTheDocument()
  })

  it('disabled — 비활성', () => {
    render(<UserStatusBadge status="disabled" />)
    expect(screen.getByText('비활성')).toBeInTheDocument()
  })
})

describe('UserRoleBadge', () => {
  it('admin — 관리자', () => {
    render(<UserRoleBadge role="admin" />)
    expect(screen.getByText('관리자')).toBeInTheDocument()
  })

  it('operator — 운영자', () => {
    render(<UserRoleBadge role="operator" />)
    expect(screen.getByText('운영자')).toBeInTheDocument()
  })
})
