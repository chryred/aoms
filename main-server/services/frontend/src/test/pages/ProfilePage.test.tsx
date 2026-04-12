import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProfilePage } from '@/pages/ProfilePage'

vi.mock('@/hooks/queries/useMe', () => ({ useMe: vi.fn() }))
vi.mock('@/hooks/mutations/useUpdateMe', () => ({ useUpdateMe: vi.fn() }))

import { useMe } from '@/hooks/queries/useMe'
import { useUpdateMe } from '@/hooks/mutations/useUpdateMe'

const mockUser = {
  id: 1,
  name: '홍길동',
  email: 'hong@test.com',
  role: 'admin',
  status: 'active',
  username: 'hong',
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useUpdateMe).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  })

  it('로딩 스켈레톤', () => {
    vi.mocked(useMe).mockReturnValue({ data: null, isLoading: true } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('사용자 정보 표시', () => {
    vi.mocked(useMe).mockReturnValue({ data: mockUser, isLoading: false } as never)
    renderPage()
    expect(screen.getByText('홍길동')).toBeInTheDocument()
    expect(screen.getAllByText('hong@test.com').length).toBeGreaterThan(0)
  })

  it('정보 수정 버튼 → 편집 폼', async () => {
    vi.mocked(useMe).mockReturnValue({ data: mockUser, isLoading: false } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '정보 수정' }))
    expect(screen.getByLabelText('이름')).toBeInTheDocument()
  })

  it('편집 취소', async () => {
    vi.mocked(useMe).mockReturnValue({ data: mockUser, isLoading: false } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '정보 수정' }))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByLabelText('이름')).not.toBeInTheDocument()
  })

  it('비밀번호 변경 아코디언 토글', async () => {
    vi.mocked(useMe).mockReturnValue({ data: mockUser, isLoading: false } as never)
    renderPage()
    // 첫 번째 버튼만 클릭 (toggle button)
    const pwButtons = screen.getAllByRole('button', { name: /비밀번호 변경/ })
    await userEvent.click(pwButtons[0])
    expect(screen.getByLabelText('현재 비밀번호')).toBeInTheDocument()
  })

  it('me가 null이면 아무것도 렌더링 안 함', () => {
    vi.mocked(useMe).mockReturnValue({ data: null, isLoading: false } as never)
    const { container } = renderPage()
    expect(container.firstChild).toBeNull()
  })
})
