import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RegisterPage } from '@/pages/auth/RegisterPage'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

const mockRegister = vi.fn()

vi.mock('@/api/auth', () => ({
  authApi: {
    register: (b: object) => mockRegister(b),
    login: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    getUsers: vi.fn(),
  },
}))

function renderRegisterPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<RegisterPage />} />
          <Route path="/login" element={<div>로그인</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RegisterPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('기본 렌더링', () => {
    renderRegisterPage()
    expect(screen.getByText('사용자 등록 신청')).toBeInTheDocument()
  })

  it('이름/이메일/비밀번호/확인 필드', () => {
    renderRegisterPage()
    expect(screen.getByLabelText('이름')).toBeInTheDocument()
    expect(screen.getByLabelText('이메일')).toBeInTheDocument()
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument()
    expect(screen.getByLabelText('비밀번호 확인')).toBeInTheDocument()
  })

  it('등록 신청 버튼', () => {
    renderRegisterPage()
    expect(screen.getByRole('button', { name: '등록 신청' })).toBeInTheDocument()
  })

  it('로그인 링크', async () => {
    renderRegisterPage()
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(screen.getByText('로그인')).toBeInTheDocument()
  })

  it('등록 성공 → 성공 화면', async () => {
    mockRegister.mockResolvedValueOnce({ message: '등록 완료' })
    renderRegisterPage()

    await userEvent.type(screen.getByLabelText('이름'), '홍길동')
    await userEvent.type(screen.getByLabelText('이메일'), 'test@test.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'Passw0rd!')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'Passw0rd!')
    await userEvent.click(screen.getByRole('button', { name: '등록 신청' }))

    expect(await screen.findByText('등록 신청이 완료되었습니다')).toBeInTheDocument()
  })

  it('빈 폼 제출 — 유효성 검사', async () => {
    renderRegisterPage()
    await userEvent.click(screen.getByRole('button', { name: '등록 신청' }))
    expect(await screen.findByText(/2자 이상/)).toBeInTheDocument()
  })
})
