import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { AdminGuard } from '@/components/layout/AdminGuard'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { useAuthStore } from '@/store/authStore'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

describe('AuthGuard', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null })
  })

  it('token 없음 → /login 리다이렉트', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <AuthGuard>
                <div>대시보드</div>
              </AuthGuard>
            }
          />
          <Route path="/login" element={<div>로그인 페이지</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('로그인 페이지')).toBeInTheDocument()
    expect(screen.queryByText('대시보드')).toBeNull()
  })

  it('token 있음 → children 렌더링', () => {
    useAuthStore.setState({ token: 'valid-token', user: null })
    render(
      <MemoryRouter>
        <AuthGuard>
          <div>보호된 컨텐츠</div>
        </AuthGuard>
      </MemoryRouter>,
    )
    expect(screen.getByText('보호된 컨텐츠')).toBeInTheDocument()
  })
})

describe('AdminGuard', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null })
  })

  it('admin 아닌 경우 → dashboard 리다이렉트', () => {
    useAuthStore.setState({
      user: {
        id: 1,
        username: 'op',
        role: 'operator',
        email: '',
        status: 'active',
        created_at: '',
      },
      token: 'tok',
    })
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route
            path="/admin/users"
            element={
              <AdminGuard>
                <div>관리자 페이지</div>
              </AdminGuard>
            }
          />
          <Route path="/dashboard" element={<div>대시보드</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('대시보드')).toBeInTheDocument()
    expect(screen.queryByText('관리자 페이지')).toBeNull()
  })

  it('admin인 경우 → children 렌더링', () => {
    useAuthStore.setState({
      user: {
        id: 1,
        username: 'admin',
        role: 'admin',
        email: '',
        status: 'active',
        created_at: '',
      },
      token: 'tok',
    })
    render(
      <MemoryRouter>
        <AdminGuard>
          <div>관리자 컨텐츠</div>
        </AdminGuard>
      </MemoryRouter>,
    )
    expect(screen.getByText('관리자 컨텐츠')).toBeInTheDocument()
  })
})

describe('AuthLayout', () => {
  it('렌더링', () => {
    const { container } = render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<AuthLayout />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(container.firstChild).toBeInTheDocument()
  })
})
