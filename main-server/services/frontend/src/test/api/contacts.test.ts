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

import { contactsApi } from '@/api/contacts'
import { adminApi } from '@/lib/ky-client'

function mockReturn(method: 'get' | 'post' | 'patch' | 'delete', value: unknown) {
  vi.mocked(adminApi[method]).mockReturnValue({ json: vi.fn().mockResolvedValue(value) } as never)
}

describe('contactsApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getContacts', async () => {
    mockReturn('get', [])
    await contactsApi.getContacts()
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/contacts')
  })

  it('getContact', async () => {
    mockReturn('get', { id: 3 })
    await contactsApi.getContact(3)
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/contacts/3')
  })

  it('createContact', async () => {
    mockReturn('post', { id: 1 })
    const body = { name: '홍길동', email: 'hong@test.com', teams_upn: 'hong@corp' }
    await contactsApi.createContact(body)
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/contacts', { json: body })
  })

  it('updateContact', async () => {
    mockReturn('patch', {})
    await contactsApi.updateContact(2, { name: '변경됨' })
    expect(adminApi.patch).toHaveBeenCalledWith('api/v1/contacts/2', { json: { name: '변경됨' } })
  })

  it('deleteContact', async () => {
    vi.mocked(adminApi.delete).mockReturnValue(undefined as never)
    await contactsApi.deleteContact(4)
    expect(adminApi.delete).toHaveBeenCalledWith('api/v1/contacts/4')
  })

  it('getSystemContacts', async () => {
    mockReturn('get', [])
    await contactsApi.getSystemContacts(10)
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/systems/10/contacts')
  })

  it('addSystemContact', async () => {
    mockReturn('post', {})
    await contactsApi.addSystemContact(10, { contact_id: 5 })
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/systems/10/contacts', {
      json: { contact_id: 5 },
    })
  })

  it('removeSystemContact', async () => {
    vi.mocked(adminApi.delete).mockReturnValue(undefined as never)
    await contactsApi.removeSystemContact(10, 5)
    expect(adminApi.delete).toHaveBeenCalledWith('api/v1/systems/10/contacts/5')
  })
})
