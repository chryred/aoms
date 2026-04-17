import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ContactListPage } from '@/pages/ContactListPage'

vi.mock('@/hooks/queries/useContacts', () => ({
  useContacts: vi.fn(),
}))
vi.mock('@/hooks/mutations/useDeleteContact', () => ({
  useDeleteContact: vi.fn(),
}))

import { useContacts } from '@/hooks/queries/useContacts'
import { useDeleteContact } from '@/hooks/mutations/useDeleteContact'

const mockContacts = [
  {
    id: 1,
    name: '홍길동',
    email: 'hong@test.com',
    teams_upn: 'hong@corp',
    webhook_url: null,
    created_at: '2026-01-01T00:00:00Z',
    systems: [],
  },
  {
    id: 2,
    name: '김철수',
    email: 'kim@test.com',
    teams_upn: null,
    webhook_url: 'https://teams.com/webhook',
    created_at: '2026-01-02T00:00:00Z',
    systems: [],
  },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ContactListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ContactListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDeleteContact).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  })

  it('로딩 중 스켈레톤', () => {
    vi.mocked(useContacts).mockReturnValue({ data: [], isLoading: true } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('담당자 목록 렌더링', () => {
    vi.mocked(useContacts).mockReturnValue({ data: mockContacts, isLoading: false } as never)
    renderPage()
    expect(screen.getByText('홍길동')).toBeInTheDocument()
    expect(screen.getByText('김철수')).toBeInTheDocument()
  })

  it('빈 목록 → 빈 상태 표시', () => {
    vi.mocked(useContacts).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    expect(screen.getByText('담당자가 없습니다')).toBeInTheDocument()
  })

  it('검색 필터링', async () => {
    vi.mocked(useContacts).mockReturnValue({ data: mockContacts, isLoading: false } as never)
    renderPage()
    await userEvent.type(screen.getByPlaceholderText(/이름, 이메일, 시스템 검색/), '홍')
    expect(screen.getByText('홍길동')).toBeInTheDocument()
    expect(screen.queryByText('김철수')).not.toBeInTheDocument()
  })

  it('삭제 버튼 클릭 → confirm 다이얼로그', async () => {
    vi.mocked(useContacts).mockReturnValue({ data: mockContacts, isLoading: false } as never)
    renderPage()
    const deleteButtons = screen.getAllByLabelText('삭제')
    await userEvent.click(deleteButtons[0])
    expect(screen.getByText('담당자 삭제')).toBeInTheDocument()
  })

  it('confirm 취소', async () => {
    vi.mocked(useContacts).mockReturnValue({ data: mockContacts, isLoading: false } as never)
    renderPage()
    const deleteButtons = screen.getAllByLabelText('삭제')
    await userEvent.click(deleteButtons[0])
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByText('담당자 삭제')).not.toBeInTheDocument()
  })

  it('confirm 삭제 실행', async () => {
    const mockMutate = vi.fn()
    vi.mocked(useDeleteContact).mockReturnValue({ mutate: mockMutate, isPending: false } as never)
    vi.mocked(useContacts).mockReturnValue({ data: mockContacts, isLoading: false } as never)
    renderPage()
    const deleteButtons = screen.getAllByLabelText('삭제')
    await userEvent.click(deleteButtons[0])
    // confirm dialog에서 삭제 버튼 (NeuButton variant="danger")
    const allDeleteBtns = screen.getAllByRole('button', { name: '삭제' })
    // dialog 안의 버튼은 위험 버튼
    await userEvent.click(allDeleteBtns[allDeleteBtns.length - 1])
    expect(mockMutate).toHaveBeenCalledWith(1, expect.any(Object))
  })
})
