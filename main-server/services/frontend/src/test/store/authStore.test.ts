import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import type { LoginResponse } from '@/types/auth'

describe('authStore', () => {
  beforeEach(() => {
    // 각 테스트 전 스토어 초기화
    useAuthStore.setState({ user: null, token: null })
    sessionStorage.clear()
  })

  it('초기 상태 — user, token 모두 null', () => {
    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.token).toBeNull()
  })

  it('login — user와 token 저장', () => {
    const mockResponse: LoginResponse = {
      access_token: 'test-token-123',
      user: {
        id: 1,
        username: 'admin',
        email: 'admin@test.com',
        role: 'admin',
        status: 'active',
        created_at: '2024-01-01T00:00:00Z',
      },
    }

    useAuthStore.getState().login(mockResponse)

    const state = useAuthStore.getState()
    expect(state.token).toBe('test-token-123')
    expect(state.user).toEqual(mockResponse.user)
  })

  it('logout — user, token 초기화', () => {
    const mockResponse: LoginResponse = {
      access_token: 'test-token',
      user: {
        id: 1,
        username: 'test',
        email: 'test@test.com',
        role: 'operator',
        status: 'active',
        created_at: '2024-01-01T00:00:00Z',
      },
    }
    useAuthStore.getState().login(mockResponse)
    useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.token).toBeNull()
  })

  it('setToken — token만 업데이트', () => {
    useAuthStore.getState().setToken('new-token')
    expect(useAuthStore.getState().token).toBe('new-token')
  })
})
