import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ContactFormPage } from '@/pages/ContactFormPage'

vi.mock('@/hooks/queries/useContacts', () => ({
  useContact: vi.fn(),
}))
vi.mock('@/hooks/mutations/useCreateContact', () => ({ useCreateContact: vi.fn() }))
vi.mock('@/hooks/mutations/useUpdateContact', () => ({ useUpdateContact: vi.fn() }))
vi.mock('@/components/contacts/ContactForm', () => ({
  ContactForm: ({ defaultValues }: { defaultValues?: unknown }) => (
    <div data-testid="contact-form">{defaultValues ? '수정 폼' : '등록 폼'}</div>
  ),
}))

import { useContact } from '@/hooks/queries/useContacts'
import { useCreateContact } from '@/hooks/mutations/useCreateContact'
import { useUpdateContact } from '@/hooks/mutations/useUpdateContact'

function renderNewPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/contacts/new']}>
        <Routes>
          <Route path="/contacts/new" element={<ContactFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function renderEditPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/contacts/1/edit']}>
        <Routes>
          <Route path="/contacts/:id/edit" element={<ContactFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ContactFormPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useCreateContact).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    vi.mocked(useUpdateContact).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  })

  it('신규 등록 — 담당자 등록 제목', () => {
    vi.mocked(useContact).mockReturnValue({ data: null, isLoading: false } as never)
    renderNewPage()
    expect(screen.getByText('담당자 등록')).toBeInTheDocument()
    expect(screen.getByTestId('contact-form')).toBeInTheDocument()
  })

  it('수정 — 로딩 중', () => {
    vi.mocked(useContact).mockReturnValue({ data: null, isLoading: true } as never)
    renderEditPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('수정 — 데이터 로드 후 수정 폼', () => {
    const existing = { id: 1, name: '홍길동', email: 'hong@test.com' }
    vi.mocked(useContact).mockReturnValue({ data: existing, isLoading: false } as never)
    renderEditPage()
    expect(screen.getByText(/담당자 수정/)).toBeInTheDocument()
  })
})
