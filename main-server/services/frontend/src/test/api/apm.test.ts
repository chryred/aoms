import { describe, it, expect, vi, beforeEach } from 'vitest'

const { get, post, put, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/lib/ky-client', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, adminApi: { get, post, put, delete: del } }
})

import { apmApi } from '@/api/apm'

const json = (v: unknown) => ({ json: () => Promise.resolve(v) })

describe('apmApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('listTransactions: system_ids 반복 파라미터, undefined 제외', async () => {
    get.mockReturnValue(json({ items: [], has_more: false }))
    await apmApi.listTransactions({
      system_ids: [1, 2],
      uri: '/a',
      error_only: true,
      limit: undefined,
    })
    const [path, opts] = get.mock.calls[0]
    expect(path).toBe('api/v1/apm/transactions')
    expect(opts.searchParams.toString()).toBe('system_ids=1&system_ids=2&uri=%2Fa&error_only=true')
  })

  it('getTransaction / getSystemSummary 경로', async () => {
    get.mockReturnValue(json({}))
    await apmApi.getTransaction('t1', 's1')
    await apmApi.getSystemSummary(7)
    expect(get.mock.calls[0][0]).toBe('api/v1/apm/transactions/t1/s1')
    expect(get.mock.calls[1][0]).toBe('api/v1/apm/systems/7/summary')
  })

  it('getScatter', async () => {
    get.mockReturnValue(json({ points: [], truncated: false }))
    await apmApi.getScatter({ system_ids: [3, 4], limit: 100 })
    const [path, opts] = get.mock.calls[0]
    expect(path).toBe('api/v1/apm/scatter')
    expect(opts.searchParams.toString()).toBe('system_ids=3&system_ids=4&limit=100')
  })

  it('대시보드 CRUD', async () => {
    const body = { name: 'n', layout: [], filters: {} }
    get.mockReturnValue(json([]))
    post.mockReturnValue(json({}))
    put.mockReturnValue(json({}))
    del.mockReturnValue(Promise.resolve(new Response(null, { status: 204 })))
    await apmApi.listDashboards()
    await apmApi.createDashboard(body)
    await apmApi.updateDashboard(5, body)
    await expect(apmApi.deleteDashboard(5)).resolves.toBeUndefined()
    await apmApi.shareDefault(5)
    expect(get.mock.calls[0][0]).toBe('api/v1/apm/dashboards')
    expect(post.mock.calls[0]).toEqual(['api/v1/apm/dashboards', { json: body }])
    expect(put.mock.calls[0]).toEqual(['api/v1/apm/dashboards/5', { json: body }])
    expect(del.mock.calls[0][0]).toBe('api/v1/apm/dashboards/5')
    expect(post.mock.calls[1][0]).toBe('api/v1/apm/dashboards/5/share-default')
  })

  it('스레드 덤프', async () => {
    get.mockReturnValue(json([]))
    post.mockReturnValue(json({ command_id: 9 }))
    await apmApi.requestThreadDump(2)
    await apmApi.listThreadDumps(2)
    await apmApi.getThreadDump(2, 9)
    expect(post.mock.calls[0][0]).toBe('api/v1/agents/2/thread-dump')
    expect(get.mock.calls[0]).toEqual([
      'api/v1/agents/2/thread-dumps',
      { searchParams: { limit: 20 } },
    ])
    expect(get.mock.calls[1][0]).toBe('api/v1/agents/2/thread-dumps/9')
  })
})
