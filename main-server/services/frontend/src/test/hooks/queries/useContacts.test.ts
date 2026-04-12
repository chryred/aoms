import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useContacts, useContact, useSystemContacts } from '@/hooks/queries/useContacts'
import { createWrapper } from '../test-utils'

const mockGetContacts = vi.fn()
const mockGetContact = vi.fn()
const mockGetSystemContacts = vi.fn()

vi.mock('@/api/contacts', () => ({
  contactsApi: {
    getContacts: () => mockGetContacts(),
    getContact: (id: number) => mockGetContact(id),
    getSystemContacts: (id: number) => mockGetSystemContacts(id),
  },
}))

describe('useContacts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('데이터 로드', async () => {
    mockGetContacts.mockResolvedValueOnce([{ id: 1 }])
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useContacts(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
  })
})

describe('useContact', () => {
  beforeEach(() => vi.clearAllMocks())

  it('id>0 — API 호출', async () => {
    mockGetContact.mockResolvedValueOnce({ id: 3 })
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useContact(3), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('id=0 — disabled', () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useContact(0), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useSystemContacts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('systemId>0 — API 호출', async () => {
    mockGetSystemContacts.mockResolvedValueOnce([])
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSystemContacts(1), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGetSystemContacts).toHaveBeenCalledWith(1)
  })

  it('systemId=0 — disabled', () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSystemContacts(0), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})
