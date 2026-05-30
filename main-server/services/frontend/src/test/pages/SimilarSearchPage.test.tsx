import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/hooks/mutations/useSimilarSearch', () => ({
  useSimilarSearch: vi.fn(),
}))
vi.mock('@/hooks/queries/useCollectionInfo', () => ({
  useCollectionInfo: vi.fn(),
}))
vi.mock('@/components/search/SimilarSearchInput', () => ({
  // 실제 컬렉션 라벨/카운트는 SimilarSearchInput 책임 → 여기선 stub.
  // SimilarSearchPage가 collectionPoints를 전달하는지만 검증하도록 prop을 노출한다.
  SimilarSearchInput: ({
    onSearch,
    collectionPoints,
  }: {
    onSearch: (p: object) => void
    collectionPoints?: Record<string, number | undefined>
  }) => (
    <div data-testid="similar-search-input">
      <span data-testid="collection-points">{JSON.stringify(collectionPoints ?? {})}</span>
      <button
        onClick={() =>
          onSearch({ query: 'test', threshold: 0.75, collection: 'metric_hourly_patterns' })
        }
      >
        검색
      </button>
    </div>
  ),
}))

import { useSimilarSearch } from '@/hooks/mutations/useSimilarSearch'
import { useCollectionInfo } from '@/hooks/queries/useCollectionInfo'

async function renderPage(urlSearch = '') {
  const { default: SimilarSearchPage } = await import('@/pages/SimilarSearchPage')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/similar${urlSearch}`]}>
        <SimilarSearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SimilarSearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useCollectionInfo).mockReturnValue({ data: null, isLoading: false } as never)
  })

  it('기본 렌더링 — 검색 전 빈 상태', async () => {
    vi.mocked(useSimilarSearch).mockReturnValue({
      mutate: vi.fn(),
      data: null,
      isPending: false,
      isError: false,
      reset: vi.fn(),
    } as never)
    await renderPage()
    expect(screen.getByText('유사 장애 검색')).toBeInTheDocument()
    expect(screen.getByText(/유사 장애를 검색해보세요/)).toBeInTheDocument()
  })

  it('로딩 상태', async () => {
    vi.mocked(useSimilarSearch).mockReturnValue({
      mutate: vi.fn(),
      data: null,
      isPending: true,
      isError: false,
      reset: vi.fn(),
    } as never)
    await renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('오류 상태', async () => {
    vi.mocked(useSimilarSearch).mockReturnValue({
      mutate: vi.fn(),
      data: null,
      isPending: false,
      isError: true,
      reset: vi.fn(),
    } as never)
    await renderPage()
    expect(screen.getByText(/다시 시도/i)).toBeInTheDocument()
  })

  it('검색 결과 없음', async () => {
    vi.mocked(useSimilarSearch).mockReturnValue({
      mutate: vi.fn(),
      data: { count: 0, results: [] },
      isPending: false,
      isError: false,
      reset: vi.fn(),
    } as never)
    await renderPage()
    // sr-only aria-live + EmptyState 두 곳에 렌더되므로 getAllByText
    expect(screen.getAllByText(/유사한 장애 패턴을 찾지 못했습니다/).length).toBeGreaterThan(0)
  })

  it('컬렉션 정보 로딩 중', async () => {
    vi.mocked(useSimilarSearch).mockReturnValue({
      mutate: vi.fn(),
      data: null,
      isPending: false,
      isError: false,
      reset: vi.fn(),
    } as never)
    vi.mocked(useCollectionInfo).mockReturnValue({ data: null, isLoading: true } as never)
    await renderPage()
    // 컬렉션 정보 로딩 중에도 검색 입력은 정상 렌더 (크래시 없음)
    expect(screen.getByTestId('similar-search-input')).toBeInTheDocument()
  })

  it('컬렉션 정보 표시', async () => {
    vi.mocked(useSimilarSearch).mockReturnValue({
      mutate: vi.fn(),
      data: null,
      isPending: false,
      isError: false,
      reset: vi.fn(),
    } as never)
    vi.mocked(useCollectionInfo).mockReturnValue({
      data: {
        metric_hourly_patterns: { status: 'green', points_count: 100, vectors_count: 100 },
        aggregation_summaries: { status: 'yellow', points_count: 50, vectors_count: 50 },
      },
      isLoading: false,
    } as never)
    await renderPage()
    // SimilarSearchPage가 컬렉션 points_count를 SimilarSearchInput에 전달하는지 검증
    expect(screen.getByTestId('collection-points')).toHaveTextContent('100')
  })
})
