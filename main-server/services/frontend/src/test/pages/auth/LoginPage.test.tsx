import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LoginPage } from '@/pages/auth/LoginPage'
import { useAuthStore } from '@/store/authStore'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/api/auth', () => ({
  authApi: {
    login: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    refresh: vi.fn(),
    register: vi.fn(),
    getUsers: vi.fn(),
    updateMe: vi.fn(),
    updateUserStatus: vi.fn(),
    updateUserRole: vi.fn(),
  },
}))

function renderLoginPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<div>대시보드</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null })
    vi.clearAllMocks()
  })

  it('기본 렌더링 — Synapse-V 타이틀', () => {
    renderLoginPage()
    expect(screen.getByText('Synapse-V')).toBeInTheDocument()
  })

  it('이메일/비밀번호 입력 필드', () => {
    renderLoginPage()
    expect(screen.getByLabelText('이메일')).toBeInTheDocument()
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument()
  })

  it('로그인 버튼', () => {
    renderLoginPage()
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument()
  })

  it('빈 폼 제출 — 유효성 검사', async () => {
    renderLoginPage()
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    // zod 오류가 표시됨
    expect(await screen.findByText(/유효한 이메일/)).toBeInTheDocument()
  })

  it('비밀번호 입력 시 강도 표시기', async () => {
    renderLoginPage()
    await userEvent.type(screen.getByLabelText('비밀번호'), 'test')
    // 강도 표시 텍스트가 나타남 (취약/보통/강함)
    expect(screen.getByText(/취약|보통|강함/)).toBeInTheDocument()
  })

  it('로그인 성공 → 네비게이션', async () => {
    const { authApi } = await import('@/api/auth')
    vi.mocked(authApi.login).mockResolvedValueOnce({
      access_token: 'tok',
      user: {
        id: 1,
        username: 'admin',
        email: 'a@b.com',
        role: 'admin',
        status: 'active',
        created_at: '',
      },
    })

    renderLoginPage()
    await userEvent.type(screen.getByLabelText('이메일'), 'admin@test.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    // 성공 후 로그인 완료 상태 (체크마크 SVG)
    expect(await screen.findByLabelText('로그인 성공')).toBeInTheDocument()
  })
})
