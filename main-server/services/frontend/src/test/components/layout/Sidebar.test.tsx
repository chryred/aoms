import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuthStore } from '@/store/authStore'

vi.mock('@/hooks/queries/useAlerts', () => ({ useAlerts: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/useUsers', () => ({ useUsers: () => ({ data: [] }) }))

describe('Sidebar 트랜잭션 그룹', () => {
  it('트랜잭션 그룹과 두 링크를 렌더링한다', () => {
    useAuthStore.setState({ token: 't', user: null })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    expect(screen.getByText('트랜잭션')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /실시간 모니터링/ })).toHaveAttribute(
      'href',
      '/apm/live',
    )
    expect(screen.getByRole('link', { name: /트랜잭션 분석/ })).toHaveAttribute(
      'href',
      '/apm/transactions',
    )
  })
})
