import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const { openSse } = vi.hoisted(() => ({ openSse: vi.fn() }))
vi.mock('@/lib/sse', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, openSse }
})

import { useAuthStore } from '@/store/authStore'
import { useApmLiveStream } from '@/hooks/useApmLiveStream'

type Emit = (event: string, data: unknown) => void
const fetchMock = vi.fn()

const activeEvt = (system_id: number, role: string, ts = 1) => ({
  system_id,
  instance_role: role,
  ts,
  slow_ms: 3000,
  buckets: [1, 0, 0],
  top: [],
})

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ instances: [] }), { status: 200 }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  openSse.mockReset()
})

describe('useApmLiveStream', () => {
  it('snapshot 으로 초기 채우고 active/agg 이벤트로 map 을 갱신한다', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          instances: [
            {
              system_id: 1,
              instance_role: 'A',
              last_seen: 1,
              active: activeEvt(1, 'A'),
              agg: [{ system_id: 1, instance_role: 'A', ts: 1, tps: 5 }],
            },
          ],
        }),
        { status: 200 },
      ),
    )
    let emit: Emit = () => {}
    openSse.mockImplementation((_p: string, cb: Emit) => {
      emit = cb
      return new Promise(() => {})
    })
    const { result } = renderHook(() => useApmLiveStream([1, 2]))
    await waitFor(() => expect(result.current.active.get('1:A')?.ts).toBe(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/t/v1/snapshot?system_ids=1,2')
    await waitFor(() => expect(openSse).toHaveBeenCalled())
    expect(openSse.mock.calls[0][0]).toBe('/t/v1/stream?system_ids=1,2')

    act(() => {
      emit('active', activeEvt(1, 'A', 99))
      emit('active', activeEvt(2, 'B', 7))
      emit('agg', { system_id: 1, instance_role: 'A', ts: 2, tps: 6 })
    })
    expect(result.current.status).toBe('open')
    expect(result.current.active.get('1:A')?.ts).toBe(99)
    expect(result.current.active.get('2:B')?.ts).toBe(7)
    expect(result.current.agg.get('1:A')).toHaveLength(2)
  })

  it('10분 지난 점은 제거한다', async () => {
    let emit: Emit = () => {}
    openSse.mockImplementation((_p: string, cb: Emit) => {
      emit = cb
      return new Promise(() => {})
    })
    const { result } = renderHook(() => useApmLiveStream([1]))
    await waitFor(() => expect(openSse).toHaveBeenCalled())
    const now = Date.now()
    const pt = (ts: number) => ({ ts, elapsed_ms: 10, error: false, trace_id: 't', span_id: 's' })
    act(() => {
      emit('points', {
        system_id: 1,
        instance_role: 'A',
        points: [pt(now - 11 * 60_000), pt(now - 1_000)],
      })
    })
    expect(result.current.points).toHaveLength(1)
    expect(result.current.points[0].points.map((p) => p.ts)).toEqual([now - 1_000])
    act(() => {
      emit('points', { system_id: 1, instance_role: 'A', points: [pt(now - 20 * 60_000)] })
    })
    expect(result.current.points).toHaveLength(1)
  })

  it('끊기면 재연결하고, 3회 연속 실패 시 polling 폴백', async () => {
    vi.useFakeTimers()
    openSse.mockRejectedValue(new Error('down'))
    const { result } = renderHook(() => useApmLiveStream([1]))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(openSse).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('retrying')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(openSse).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(openSse).toHaveBeenCalledTimes(3)
    expect(result.current.status).toBe('fallback')
    const before = fetchMock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(before + 2)
    expect(openSse).toHaveBeenCalledTimes(3)
  })

  it('폴백 중 30초마다 스트림 재연결을 시도하고 성공하면 open', async () => {
    vi.useFakeTimers()
    let emit: Emit = () => {}
    openSse
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('still down'))
      .mockImplementation((_p: string, cb: Emit) => {
        emit = cb
        return new Promise(() => {})
      })
    const { result } = renderHook(() => useApmLiveStream([1]))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100)
    })
    expect(result.current.status).toBe('fallback')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })
    expect(openSse).toHaveBeenCalledTimes(4)
    expect(result.current.status).toBe('fallback')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })
    expect(openSse).toHaveBeenCalledTimes(5)
    act(() => emit('active', activeEvt(1, 'A', 5)))
    expect(result.current.status).toBe('open')
    const polls = fetchMock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock.mock.calls.length).toBe(polls)
  })

  it('snapshot 401 이면 refresh 후 새 토큰으로 재시도한다', async () => {
    useAuthStore.setState({ token: 'old' })
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            instances: [
              {
                system_id: 1,
                instance_role: 'A',
                last_seen: 1,
                active: activeEvt(1, 'A', 42),
                agg: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )
    openSse.mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useApmLiveStream([1]))
    await waitFor(() => expect(result.current.active.get('1:A')?.ts).toBe(42))
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer old')
    expect(fetchMock.mock.calls[1][0]).toContain('api/v1/auth/refresh')
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new')
  })

  it('언마운트 시 연결을 abort 한다', async () => {
    let signal: AbortSignal | undefined
    openSse.mockImplementation((_p: string, _cb: Emit, s: AbortSignal) => {
      signal = s
      return new Promise(() => {})
    })
    const { unmount } = renderHook(() => useApmLiveStream([1]))
    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal!.aborted).toBe(true)
  })
})
