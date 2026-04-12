import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SystemListPage } from '@/pages/system/SystemListPage'

vi.mock('@/hooks/queries/useSystems', () => ({
  useSystems: vi.fn(),
}))
vi.mock('@/components/system/SystemTable', () => ({
  SystemTable: ({ systems, searchQuery }: { systems: unknown[]; searchQuery: string }) => (
    <div data-testid="system-table">
      {searchQuery && <span>검색: {searchQuery}</span>}
      <span>시스템 {systems.length}개</span>
    </div>
  ),
}))
vi.mock('@/components/system/SystemFormDrawer', () => ({
  SystemFormDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="system-form-drawer">드로어</div> : null,
}))

import { useSystems } from '@/hooks/queries/useSystems'

const mockSystems = [
  { id: 1, system_name: 'sys1', display_name: '시스템1' },
  { id: 2, system_name: 'sys2', display_name: '시스템2' },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SystemListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SystemListPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('로딩 중 스켈레톤 표시', () => {
    vi.mocked(useSystems).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('오류 시 ErrorCard 표시', () => {
    vi.mocked(useSystems).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('err'),
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText(/다시 시도/i)).toBeInTheDocument()
  })

  it('데이터 로드 — 시스템 테이블 표시', () => {
    vi.mocked(useSystems).mockReturnValue({
      data: mockSystems,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByTestId('system-table')).toBeInTheDocument()
    expect(screen.getByText('시스템 관리')).toBeInTheDocument()
  })

  it('시스템 등록 버튼 클릭 → 드로어 열림', async () => {
    vi.mocked(useSystems).mockReturnValue({
      data: mockSystems,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /시스템 등록/ }))
    expect(screen.getByTestId('system-form-drawer')).toBeInTheDocument()
  })

  it('검색어 입력 → 테이블에 전달', async () => {
    vi.mocked(useSystems).mockReturnValue({
      data: mockSystems,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    await userEvent.type(screen.getByPlaceholderText(/시스템명/), 'test')
    expect(screen.getByText('검색: test')).toBeInTheDocument()
  })
})
