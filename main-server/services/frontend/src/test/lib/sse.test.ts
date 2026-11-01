import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { consumeSSE, fetchWithRefresh, openSse } from '@/lib/sse'
import { useAuthStore } from '@/store/authStore'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
}

describe('consumeSSE', () => {
  it('청크 경계에 걸친 이벤트 2개를 파싱한다', async () => {
    const events: [string, unknown][] = []
    await consumeSSE(
      streamOf(['event: active\ndata: {"a"', ':1}\n\nevent: po', 'ints\ndata: {"b":2}\n\n']),
      (e, d) => events.push([e, d]),
    )
    expect(events).toEqual([
      ['active', { a: 1 }],
      ['points', { b: 2 }],
    ])
  })

  it('event 없으면 message, 깨진 JSON/빈 data 는 무시', async () => {
    const events: [string, unknown][] = []
    await consumeSSE(streamOf(['data: {"x":1}\n\ndata: {oops\n\nevent: ping\n\n']), (e, d) =>
      events.push([e, d]),
    )
    expect(events).toEqual([['message', { x: 1 }]])
  })
})

describe('openSse', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    useAuthStore.setState({ token: 'old' })
  })
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('Authorization 헤더로 연결하고 이벤트를 전달한다', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(streamOf(['event: ping\ndata: {}\n\n']), { status: 200 }),
    )
    const onEvent = vi.fn()
    await openSse('/t/v1/stream?system_ids=1', onEvent, new AbortController().signal)
    expect(fetchMock.mock.calls[0][0]).toBe('/t/v1/stream?system_ids=1')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer old')
    expect(onEvent).toHaveBeenCalledWith('ping', {})
  })

  it('401 이면 refresh 1회 후 새 토큰으로 재시도한다', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(streamOf(['event: ping\ndata: {}\n\n']), { status: 200 }))
    const onEvent = vi.fn()
    await openSse('/t/v1/stream', onEvent, new AbortController().signal)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][0]).toContain('api/v1/auth/refresh')
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new')
    expect(useAuthStore.getState().token).toBe('new')
    expect(onEvent).toHaveBeenCalledWith('ping', {})
  })

  it('refresh 실패 시 throw', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
    await expect(openSse('/t/v1/stream', vi.fn(), new AbortController().signal)).rejects.toThrow()
  })

  it('재시도 후에도 비 2xx 이면 throw', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 502 }))
    await expect(openSse('/t/v1/stream', vi.fn(), new AbortController().signal)).rejects.toThrow(
      '502',
    )
  })
})

describe('fetchWithRefresh', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('토큰 없으면 Authorization 생략, 200 이면 그대로 반환', async () => {
    const f = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', f)
    useAuthStore.setState({ token: null })
    const r = await fetchWithRefresh('/x', { headers: { A: 'b' } })
    expect(r.status).toBe(200)
    expect(f.mock.calls[0][1].headers).toEqual({ A: 'b' })
  })
})
