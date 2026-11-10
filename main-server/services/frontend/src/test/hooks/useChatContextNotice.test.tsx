import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatContextNotice } from '@/hooks/useChatContextNotice'
import { useChatStore } from '@/store/chatStore'
import type { ScreenContext } from '@/types/chat'

type P = { active: boolean; messageCount: number; screenContext: ScreenContext }

const mount = (initial: P) =>
  renderHook((p: P) => useChatContextNotice({ ...p, currentSessionId: 's1' }), {
    initialProps: initial,
  })

describe('useChatContextNotice — 다른 화면에서 열었을 때 안내', () => {
  beforeEach(() => {
    localStorage.clear()
    useChatStore.setState({ lastSentContext: { sessionId: 's1', system_id: '3' } })
  })

  it('메시지가 있고 시스템이 다른 화면에서 열면 안내를 보인다', () => {
    const { result } = mount({ active: true, messageCount: 4, screenContext: { system_id: '5' } })
    expect(result.current.show).toBe(true)
  })

  it('같은 시스템이면 안내하지 않는다', () => {
    const { result } = mount({ active: true, messageCount: 4, screenContext: { system_id: '3' } })
    expect(result.current.show).toBe(false)
  })

  it('메시지가 없으면 안내하지 않는다', () => {
    const { result } = mount({ active: true, messageCount: 0, screenContext: { system_id: '5' } })
    expect(result.current.show).toBe(false)
  })

  it('시스템·인시던트가 없는 화면에서는 안내하지 않는다', () => {
    const { result } = mount({ active: true, messageCount: 4, screenContext: { screen: 'alerts' } })
    expect(result.current.show).toBe(false)
  })

  it('[계속]을 누르면 사라지고, 닫았다 다시 열면 다시 판정한다', () => {
    const { result, rerender } = mount({
      active: true,
      messageCount: 4,
      screenContext: { system_id: '5' },
    })
    act(() => result.current.dismiss())
    expect(result.current.show).toBe(false)

    rerender({ active: false, messageCount: 4, screenContext: { system_id: '5' } })
    rerender({ active: true, messageCount: 4, screenContext: { system_id: '5' } })
    expect(result.current.show).toBe(true)
  })

  it('열린 뒤 질문을 보내 기억된 컨텍스트가 바뀌면 안내를 거둔다', () => {
    const { result } = mount({ active: true, messageCount: 4, screenContext: { system_id: '5' } })
    expect(result.current.show).toBe(true)
    act(() => useChatStore.getState().setLastSentContext({ sessionId: 's1', system_id: '5' }))
    expect(result.current.show).toBe(false)
  })
})
