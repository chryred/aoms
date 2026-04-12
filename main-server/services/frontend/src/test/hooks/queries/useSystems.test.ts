import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSystems, useSystem } from '@/hooks/queries/useSystems'
import { createWrapper } from '../test-utils'

const mockGetSystems = vi.fn()
const mockGetSystem = vi.fn()

vi.mock('@/api/systems', () => ({
  systemsApi: {
    getSystems: () => mockGetSystems(),
    getSystem: (id: number) => mockGetSystem(id),
  },
}))

describe('useSystems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('데이터 로드 성공', async () => {
    const systems = [{ id: 1, system_name: 'test', display_name: '테스트' }]
    mockGetSystems.mockResolvedValueOnce(systems)
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSystems(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(systems)
  })

  it('로딩 상태', () => {
    mockGetSystems.mockImplementation(() => new Promise(() => {}))
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSystems(), { wrapper: Wrapper })
    expect(result.current.isLoading).toBe(true)
  })

  it('에러 상태', async () => {
    mockGetSystems.mockRejectedValueOnce(new Error('네트워크 오류'))
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSystems(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('id>0 — API 호출', async () => {
    mockGetSystem.mockResolvedValueOnce({ id: 5, system_name: 'sys5' })
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSystem(5), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGetSystem).toHaveBeenCalledWith(5)
  })

  it('id=0 — enabled=false (호출 안 됨)', () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSystem(0), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetSystem).not.toHaveBeenCalled()
  })
})
