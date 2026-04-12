import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ky-client', () => ({
  adminApi: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  filterParams: vi.fn((p: object) => p),
}))

import { authApi } from '@/api/auth'
import { adminApi } from '@/lib/ky-client'

function mockReturn(method: 'get' | 'post' | 'patch' | 'delete', value: unknown) {
  vi.mocked(adminApi[method]).mockReturnValue({ json: vi.fn().mockResolvedValue(value) } as never)
}

describe('authApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('login', async () => {
    mockReturn('post', { access_token: 'tok', user: {} })
    const body = { username: 'admin', password: 'pass' }
    await authApi.login(body)
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/auth/login', { json: body })
  })

  it('refresh', async () => {
    mockReturn('post', { access_token: 'new-tok' })
    await authApi.refresh()
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/auth/refresh')
  })

  it('logout', async () => {
    vi.mocked(adminApi.post).mockReturnValue(undefined as never)
    await authApi.logout()
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/auth/logout')
  })

  it('me', async () => {
    mockReturn('get', { id: 1 })
    await authApi.me()
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/auth/me')
  })

  it('register', async () => {
    mockReturn('post', { message: 'ok' })
    const body = { username: 'new', password: 'pass', email: 'a@b.com' }
    await authApi.register(body)
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/auth/register', { json: body })
  })

  it('getUsers', async () => {
    mockReturn('get', [])
    await authApi.getUsers()
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/auth/users')
  })

  it('updateUserStatus', async () => {
    mockReturn('patch', {})
    const body = { status: 'active' as const }
    await authApi.updateUserStatus(1, body)
    expect(adminApi.patch).toHaveBeenCalledWith('api/v1/auth/users/1/status', { json: body })
  })

  it('updateUserRole', async () => {
    mockReturn('patch', {})
    const body = { role: 'admin' as const }
    await authApi.updateUserRole(1, body)
    expect(adminApi.patch).toHaveBeenCalledWith('api/v1/auth/users/1/role', { json: body })
  })

  it('updateMe', async () => {
    mockReturn('patch', {})
    await authApi.updateMe({ email: 'new@test.com' })
    expect(adminApi.patch).toHaveBeenCalledWith('api/v1/auth/me', {
      json: { email: 'new@test.com' },
    })
  })
})
