import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useChatSessionBootstrap } from '@/hooks/useChatSessionBootstrap'
import { useChatStore } from '@/store/chatStore'
import { useAuthStore } from '@/store/authStore'
import { chatApi } from '@/api/chat'
import { createWrapper } from '../hooks/test-utils'
import type { ChatSession } from '@/types/chat'

vi.mock('@/api/chat', () => ({
  chatApi: { listSessions: vi.fn(), createSession: vi.fn() },
}))

const session = (id: string, created_at: string): ChatSession => ({
  id,
  title: id,
  area_code: 'chat_assistant',
  system_ids: [],
  created_at,
  updated_at: created_at,
})

// "지금" = KST 2026-11-10 10:00 (UTC 01:00). 오늘 KST 시작 = UTC 2026-11-09T15:00
const NOW = new Date('2026-11-10T10:00:00+09:00')
const TODAY_UTC = '2026-11-10T00:30:00'
const YESTERDAY_UTC = '2026-11-09T14:59:59' // KST 어제 23:59:59

function mount(opts: { active: boolean; scopeIds?: number[]; scopeReady?: boolean }) {
  const { Wrapper } = createWrapper()
  return renderHook(
    (p: { active: boolean }) =>
      useChatSessionBootstrap({
        active: p.active,
        scopeIds: opts.scopeIds ?? [3],
        scopeReady: opts.scopeReady ?? true,
      }),
    { wrapper: Wrapper, initialProps: { active: opts.active } },
  )
}

describe('useChatSessionBootstrap', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    useAuthStore.setState({ user: null, token: null })
    useChatStore.setState({ currentSessionId: null, isOpen: false })
    vi.mocked(chatApi.listSessions).mockReset()
    vi.mocked(chatApi.createSession).mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('현재 세션이 오늘(KST) 시작이면 그대로 유지하고 새로 만들지 않는다', async () => {
    useChatStore.setState({ currentSessionId: 'cur' })
    vi.mocked(chatApi.listSessions).mockResolvedValue([session('cur', TODAY_UTC)])
    const { result } = mount({ active: true })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(useChatStore.getState().currentSessionId).toBe('cur')
    expect(chatApi.createSession).not.toHaveBeenCalled()
  })

  it('KST 자정 직전에 시작한 현재 세션은 오늘이 아니므로 새 세션을 만든다(system_ids 한 번에 전달)', async () => {
    useChatStore.setState({ currentSessionId: 'old' })
    vi.mocked(chatApi.listSessions).mockResolvedValue([session('old', YESTERDAY_UTC)])
    vi.mocked(chatApi.createSession).mockResolvedValue(session('new', TODAY_UTC))
    const { result } = mount({ active: true, scopeIds: [3, 4] })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(chatApi.createSession).toHaveBeenCalledTimes(1)
    expect(chatApi.createSession).toHaveBeenCalledWith([3, 4])
    expect(useChatStore.getState().currentSessionId).toBe('new')
  })

  it('오늘 만든 세션이 이미 있으면(빈 세션 포함) 그 세션을 재사용한다', async () => {
    useChatStore.setState({ currentSessionId: 'old' })
    vi.mocked(chatApi.listSessions).mockResolvedValue([
      session('old', YESTERDAY_UTC),
      session('today-empty', TODAY_UTC),
    ])
    const { result } = mount({ active: true })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(useChatStore.getState().currentSessionId).toBe('today-empty')
    expect(chatApi.createSession).not.toHaveBeenCalled()
  })

  it('담당 시스템 응답 전(scopeReady=false)에는 세션을 만들지 않는다', async () => {
    vi.mocked(chatApi.listSessions).mockResolvedValue([])
    vi.mocked(chatApi.createSession).mockResolvedValue(session('new', TODAY_UTC))
    const { result, rerender } = mount({ active: true, scopeReady: false })
    await waitFor(() => expect(chatApi.listSessions).toHaveBeenCalled())
    await act(async () => {
      await Promise.resolve()
    })
    expect(chatApi.createSession).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(false)
    rerender({ active: true })
  })

  it('동시에 여러 번 호출돼도 세션은 한 번만 생성된다', async () => {
    vi.mocked(chatApi.listSessions).mockResolvedValue([])
    let resolveCreate: (s: ChatSession) => void = () => {}
    vi.mocked(chatApi.createSession).mockImplementation(
      () => new Promise<ChatSession>((res) => (resolveCreate = res)),
    )
    const { result } = mount({ active: true })
    await waitFor(() => expect(chatApi.createSession).toHaveBeenCalledTimes(1))
    // 생성 진행 중 "새 대화" 연타 + 리렌더
    await act(async () => {
      const a = result.current.startNewSession()
      const b = result.current.startNewSession()
      expect(await a).toBeNull()
      expect(await b).toBeNull()
    })
    expect(chatApi.createSession).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveCreate(session('new', TODAY_UTC))
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(chatApi.createSession).toHaveBeenCalledTimes(1)
  })

  it('닫혀 있는 동안에는 아무 것도 하지 않고, 열 때(false→true) 판정한다', async () => {
    useChatStore.setState({ currentSessionId: 'old' })
    vi.mocked(chatApi.listSessions).mockResolvedValue([session('old', YESTERDAY_UTC)])
    // 서버 목록은 생성 뒤 새 세션을 포함한다
    vi.mocked(chatApi.createSession).mockImplementation(async () => {
      vi.mocked(chatApi.listSessions).mockResolvedValue([
        session('new', TODAY_UTC),
        session('old', YESTERDAY_UTC),
      ])
      return session('new', TODAY_UTC)
    })
    const { result, rerender } = mount({ active: false })
    await act(async () => {
      await Promise.resolve()
    })
    expect(chatApi.listSessions).not.toHaveBeenCalled()
    expect(chatApi.createSession).not.toHaveBeenCalled()

    rerender({ active: true })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(useChatStore.getState().currentSessionId).toBe('new')

    // 닫았다 다시 열면 이번엔 오늘 세션이라 유지
    rerender({ active: false })
    await waitFor(() => expect(result.current.ready).toBe(false))
    rerender({ active: true })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(chatApi.createSession).toHaveBeenCalledTimes(1)
  })
  it('생성 직후 닫았다 곧바로 다시 열어도(목록 재조회 전) 세션을 또 만들지 않는다', async () => {
    useChatStore.setState({ currentSessionId: 'old' })
    vi.mocked(chatApi.listSessions).mockResolvedValueOnce([session('old', YESTERDAY_UTC)])
    vi.mocked(chatApi.createSession).mockImplementation(async () => {
      // 이후 재조회는 끝나지 않는다 = 닫힌 동안 캐시는 낡은 목록
      vi.mocked(chatApi.listSessions).mockReturnValue(new Promise(() => {}))
      return session('new', TODAY_UTC)
    })
    const { result, rerender } = mount({ active: true })
    await waitFor(() => expect(result.current.ready).toBe(true))
    rerender({ active: false })
    await waitFor(() => expect(result.current.ready).toBe(false))
    rerender({ active: true })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(chatApi.createSession).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().currentSessionId).toBe('new')
  })
})
