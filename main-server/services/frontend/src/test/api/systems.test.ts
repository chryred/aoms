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

import { systemsApi } from '@/api/systems'
import { adminApi } from '@/lib/ky-client'

function mockReturn(method: 'get' | 'post' | 'patch' | 'delete', value: unknown) {
  vi.mocked(adminApi[method]).mockReturnValue({ json: vi.fn().mockResolvedValue(value) } as never)
}

describe('systemsApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getSystems', async () => {
    mockReturn('get', [{ id: 1 }])
    await systemsApi.getSystems()
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/systems')
  })

  it('getSystem', async () => {
    mockReturn('get', { id: 5 })
    await systemsApi.getSystem(5)
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/systems/5')
  })

  it('createSystem', async () => {
    mockReturn('post', { id: 1 })
    const body = { system_name: 'test', display_name: '테스트', status: 'active' as const }
    await systemsApi.createSystem(body)
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/systems', { json: body })
  })

  it('updateSystem', async () => {
    mockReturn('patch', { id: 2 })
    await systemsApi.updateSystem(2, { display_name: '수정' })
    expect(adminApi.patch).toHaveBeenCalledWith('api/v1/systems/2', {
      json: { display_name: '수정' },
    })
  })

  it('deleteSystem', async () => {
    vi.mocked(adminApi.delete).mockReturnValue(undefined as never)
    await systemsApi.deleteSystem(3)
    expect(adminApi.delete).toHaveBeenCalledWith('api/v1/systems/3')
  })
})
