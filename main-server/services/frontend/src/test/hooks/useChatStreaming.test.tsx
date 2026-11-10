import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useChatStreaming } from '@/hooks/useChatStreaming'
import { useChatStore } from '@/store/chatStore'
import { streamChatMessage, streamAutoInsight } from '@/api/chat'
import { createWrapper } from '../hooks/test-utils'
import type { ChatStreamEvent, ScreenContext } from '@/types/chat'

vi.mock('@/api/chat', () => ({
  streamChatMessage: vi.fn(),
  streamAutoInsight: vi.fn(),
}))

type Props = { screenContext: ScreenContext }

function mount(initial: ScreenContext) {
  const { Wrapper } = createWrapper()
  return renderHook(
    (p: Props) =>
      useChatStreaming({
        currentSessionId: 'sess-1',
        screenContext: p.screenContext,
        readyKeys: [],
        clearAttachments: () => {},
        messages: [],
      }),
    { wrapper: Wrapper, initialProps: { screenContext: initial } },
  )
}

describe('useChatStreaming — scope 이벤트·최신 화면 컨텍스트', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(streamChatMessage).mockReset()
    vi.mocked(streamAutoInsight).mockReset()
    useChatStore.setState({ lastSentContext: null })
  })

  it('scope 이벤트를 받으면 스트리밍 중 streamScope 에 담고, 끝나면 비운다', async () => {
    let release: () => void = () => {}
    vi.mocked(streamChatMessage).mockImplementation(async (_s, _c, _k, onEvent) => {
      onEvent({
        type: 'scope',
        data: { source: 'session', systems: [{ id: 1, system_name: 'pay', display_name: '결제' }] },
      } as ChatStreamEvent)
      await new Promise<void>((res) => (release = res))
    })
    const { result } = mount({})
    let sending: Promise<void> = Promise.resolve()
    act(() => {
      sending = result.current.handleSend('질문')
    })
    await waitFor(() => expect(result.current.streamScope?.source).toBe('session'))
    expect(result.current.streamScope?.systems[0].display_name).toBe('결제')

    await act(async () => {
      release()
      await sending
    })
    expect(result.current.streamScope).toBeNull()
  })

  it('전송하는 순간의 화면 컨텍스트를 보낸다(열 때 값이 아니라 최신 값)', async () => {
    vi.mocked(streamChatMessage).mockResolvedValue(undefined)
    const { result, rerender } = mount({ screen: 'dashboard', screen_label: '운영 대시보드' })

    // 패널을 연 뒤 다른 화면으로 이동
    rerender({
      screenContext: { screen: 'systems', system_id: '3', system_name: 'pay' },
    })
    await act(async () => {
      await result.current.handleSend('이 시스템 상태는?')
    })

    const args = vi.mocked(streamChatMessage).mock.calls[0]
    expect(args[6]).toEqual({ screen: 'systems', system_id: '3', system_name: 'pay' })

    // 다음 질문 전에 또 이동하면 그 값이 간다
    rerender({ screenContext: { screen: 'incidents', incident_id: '9' } })
    await act(async () => {
      await result.current.handleSend('이 인시던트는?')
    })
    expect(vi.mocked(streamChatMessage).mock.calls[1][6]).toEqual({
      screen: 'incidents',
      incident_id: '9',
    })
  })

  it('자동 분석도 그 순간의 화면 컨텍스트를 보내고, 사용한 컨텍스트를 기억한다', async () => {
    vi.mocked(streamAutoInsight).mockResolvedValue(undefined)
    const { result } = mount({ screen: 'incidents', incident_id: '9' })
    await act(async () => {
      await result.current.handleAutoInsight(9)
    })
    expect(vi.mocked(streamAutoInsight).mock.calls[0][4]).toEqual({
      screen: 'incidents',
      incident_id: '9',
    })
    expect(useChatStore.getState().lastSentContext).toEqual({
      sessionId: 'sess-1',
      system_id: undefined,
      incident_id: '9',
    })
  })
})
