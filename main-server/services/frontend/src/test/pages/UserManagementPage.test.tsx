import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserManagementPage } from '@/pages/admin/UserManagementPage'

vi.mock('@/store/authStore', () => ({
  useAuthStore: vi.fn((selector: (s: object) => unknown) => selector({ user: { id: 99 } })),
}))
vi.mock('@/hooks/queries/useUsers', () => ({ useUsers: vi.fn() }))
vi.mock('@/hooks/mutations/useUpdateUserStatus', () => ({ useUpdateUserStatus: vi.fn() }))
vi.mock('@/hooks/mutations/useUpdateUserRole', () => ({ useUpdateUserRole: vi.fn() }))

import { useUsers } from '@/hooks/queries/useUsers'
import { useUpdateUserStatus } from '@/hooks/mutations/useUpdateUserStatus'
import { useUpdateUserRole } from '@/hooks/mutations/useUpdateUserRole'

const mockUsers = [
  {
    id: 1,
    name: '홍길동',
    email: 'hong@test.com',
    role: 'operator',
    is_active: true,
    is_approved: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 2,
    name: '대기자',
    email: 'wait@test.com',
    role: 'operator',
    is_active: true,
    is_approved: false,
    created_at: '2026-01-02T00:00:00Z',
  },
  {
    id: 3,
    name: '비활성',
    email: 'inactive@test.com',
    role: 'operator',
    is_active: false,
    is_approved: true,
    created_at: '2026-01-03T00:00:00Z',
  },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UserManagementPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('UserManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useUpdateUserStatus).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useUpdateUserRole).mockReturnValue({ mutate: vi.fn() } as never)
  })

  it('로딩 스켈레톤', () => {
    vi.mocked(useUsers).mockReturnValue({ data: [], isLoading: true } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('사용자 목록 렌더링', () => {
    vi.mocked(useUsers).mockReturnValue({ data: mockUsers, isLoading: false } as never)
    renderPage()
    expect(screen.getByText('홍길동')).toBeInTheDocument()
    expect(screen.getByText('대기자')).toBeInTheDocument()
  })

  it('탭 전환 — 승인 대기', async () => {
    vi.mocked(useUsers).mockReturnValue({ data: mockUsers, isLoading: false } as never)
    renderPage()
    // "승인 대기" span 텍스트를 포함하는 버튼 찾기
    const pendingTab = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('승인 대기'))
    expect(pendingTab).toBeTruthy()
    if (pendingTab) await userEvent.click(pendingTab)
    expect(screen.getByText('대기자')).toBeInTheDocument()
  })

  it('전체 탭 목록 렌더링', () => {
    vi.mocked(useUsers).mockReturnValue({ data: mockUsers, isLoading: false } as never)
    renderPage()
    const buttons = screen.getAllByRole('button')
    const tabLabels = buttons.map((b) => b.textContent ?? '')
    expect(tabLabels.some((t) => t.includes('전체'))).toBe(true)
    expect(tabLabels.some((t) => t.includes('승인 대기'))).toBe(true)
  })

  it('활성 탭 필터링', async () => {
    vi.mocked(useUsers).mockReturnValue({ data: mockUsers, isLoading: false } as never)
    renderPage()
    const activeTab = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('활성') && b.textContent?.includes('1'))
    if (activeTab) await userEvent.click(activeTab)
    expect(screen.getByText('홍길동')).toBeInTheDocument()
  })
})
