/**
 * Mutation hooks 통합 테스트
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createWrapper } from '../test-utils'
import toast from 'react-hot-toast'

// ── API 모킹 ──────────────────────────────────────────────
const mockCreateSystem = vi.fn()
const mockUpdateSystem = vi.fn()
const mockDeleteSystem = vi.fn()
const mockCreateContact = vi.fn()
const mockUpdateContact = vi.fn()
const mockDeleteContact = vi.fn()
const mockAddSystemContact = vi.fn()
const mockRemoveSystemContact = vi.fn()
const mockAcknowledgeAlert = vi.fn()
const mockRegister = vi.fn()
const mockUpdateMe = vi.fn()
const mockUpdateUserRole = vi.fn()
const mockUpdateUserStatus = vi.fn()
const mockSimilarSearch = vi.fn()

vi.mock('@/api/systems', () => ({
  systemsApi: {
    getSystems: vi.fn(),
    getSystem: vi.fn(),
    createSystem: (b: object) => mockCreateSystem(b),
    updateSystem: (id: number, b: object) => mockUpdateSystem(id, b),
    deleteSystem: (id: number) => mockDeleteSystem(id),
  },
}))

vi.mock('@/api/contacts', () => ({
  contactsApi: {
    getContacts: vi.fn(),
    getContact: vi.fn(),
    getSystemContacts: vi.fn(),
    createContact: (b: object) => mockCreateContact(b),
    updateContact: (id: number, b: object) => mockUpdateContact(id, b),
    deleteContact: (id: number) => mockDeleteContact(id),
    addSystemContact: (sId: number, b: object) => mockAddSystemContact(sId, b),
    removeSystemContact: (sId: number, cId: number) => mockRemoveSystemContact(sId, cId),
  },
}))

vi.mock('@/api/alerts', () => ({
  alertsApi: {
    getAlerts: vi.fn(),
    acknowledgeAlert: (id: number, b: object) => mockAcknowledgeAlert(id, b),
  },
}))

vi.mock('@/api/auth', () => ({
  authApi: {
    me: vi.fn(),
    getUsers: vi.fn(),
    register: (b: object) => mockRegister(b),
    updateMe: (b: object) => mockUpdateMe(b),
    updateUserRole: (id: number, b: object) => mockUpdateUserRole(id, b),
    updateUserStatus: (id: number, b: object) => mockUpdateUserStatus(id, b),
  },
}))

vi.mock('@/api/logAnalyzer', () => ({
  logAnalyzerSearchApi: {
    similarSearch: (b: object) => mockSimilarSearch(b),
    getCollectionInfo: vi.fn(),
    getAggregationStatus: vi.fn(),
  },
}))

describe('useCreateSystem', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공 시 toast.success', async () => {
    mockCreateSystem.mockResolvedValueOnce({ id: 1 })
    const { useCreateSystem } = await import('@/hooks/mutations/useCreateSystem')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateSystem(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ system_name: 'test', display_name: '테스트', status: 'active' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(toast.success).toHaveBeenCalled()
  })

  it('실패 시 toast.error', async () => {
    mockCreateSystem.mockRejectedValueOnce(new Error('오류'))
    const { useCreateSystem } = await import('@/hooks/mutations/useCreateSystem')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateSystem(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ system_name: 'test', display_name: '테스트', status: 'active' })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalled()
  })
})

describe('useUpdateSystem', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockUpdateSystem.mockResolvedValueOnce({ id: 1 })
    const { useUpdateSystem } = await import('@/hooks/mutations/useUpdateSystem')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateSystem(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ id: 1, body: { display_name: '수정' } })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(toast.success).toHaveBeenCalled()
  })
})

describe('useDeleteSystem', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockDeleteSystem.mockResolvedValueOnce(undefined)
    const { useDeleteSystem } = await import('@/hooks/mutations/useDeleteSystem')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteSystem(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate(1)
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(toast.success).toHaveBeenCalled()
  })
})

describe('useCreateContact', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockCreateContact.mockResolvedValueOnce({ id: 1 })
    const { useCreateContact } = await import('@/hooks/mutations/useCreateContact')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateContact(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ name: '홍길동', email: 'a@b.com', teams_upn: 'upn@corp' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(toast.success).toHaveBeenCalled()
  })
})

describe('useUpdateContact', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockUpdateContact.mockResolvedValueOnce({ id: 1 })
    const { useUpdateContact } = await import('@/hooks/mutations/useUpdateContact')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateContact(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ id: 1, body: { name: '수정' } })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useDeleteContact', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockDeleteContact.mockResolvedValueOnce(undefined)
    const { useDeleteContact } = await import('@/hooks/mutations/useDeleteContact')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteContact(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate(3)
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useAddSystemContact', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockAddSystemContact.mockResolvedValueOnce({})
    const { useAddSystemContact } = await import('@/hooks/mutations/useAddSystemContact')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAddSystemContact(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ systemId: 1, body: { contact_id: 2 } })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useRemoveSystemContact', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockRemoveSystemContact.mockResolvedValueOnce(undefined)
    const { useRemoveSystemContact } = await import('@/hooks/mutations/useRemoveSystemContact')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useRemoveSystemContact(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ systemId: 1, contactId: 2 })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useAcknowledgeAlert', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockAcknowledgeAlert.mockResolvedValueOnce({ id: 1 })
    const { useAcknowledgeAlert } = await import('@/hooks/mutations/useAcknowledgeAlert')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAcknowledgeAlert(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ id: 1, acknowledged_by: 'admin' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useRegister', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockRegister.mockResolvedValueOnce({ message: '등록 완료' })
    const { useRegister } = await import('@/hooks/mutations/useRegister')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useRegister(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ username: 'new', password: 'pass', email: 'n@t.com' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useUpdateMe', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockUpdateMe.mockResolvedValueOnce({ id: 1 })
    const { useUpdateMe } = await import('@/hooks/mutations/useUpdateMe')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateMe(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ email: 'new@test.com' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useUpdateUserRole', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockUpdateUserRole.mockResolvedValueOnce({})
    const { useUpdateUserRole } = await import('@/hooks/mutations/useUpdateUserRole')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateUserRole(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ id: 1, role: 'admin' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useUpdateUserStatus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockUpdateUserStatus.mockResolvedValueOnce({})
    const { useUpdateUserStatus } = await import('@/hooks/mutations/useUpdateUserStatus')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateUserStatus(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({ id: 1, status: 'active' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useSimilarSearch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('성공', async () => {
    mockSimilarSearch.mockResolvedValueOnce({ results: [] })
    const { useSimilarSearch } = await import('@/hooks/mutations/useSimilarSearch')
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSimilarSearch(), { wrapper: Wrapper })
    await act(async () => {
      result.current.mutate({
        query: 'CPU 급등',
        threshold: 0.8,
        collection: 'metric_hourly_patterns',
      })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})
