import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { useChatStore, chatStorageKey } from '@/store/chatStore'
import type { User } from '@/types/auth'

const user = (id: number): User => ({ id, name: `u${id}`, email: `u${id}@t.com`, role: 'operator' })

function loginAs(id: number) {
  useAuthStore.setState({ user: user(id), token: 't' })
}

describe('chatStore — 사용자별 persist', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: null, token: null })
    useChatStore.setState({ currentSessionId: null, scopeSystemIds: null, isOpen: false })
  })

  it('저장 키는 chat-ui-state.{userId}', () => {
    expect(chatStorageKey(7)).toBe('chat-ui-state.7')
    expect(chatStorageKey(null)).toBeNull()
  })

  it('로그인 사용자 키에만 저장하고 isOpen 은 저장하지 않는다', () => {
    loginAs(1)
    useChatStore.getState().setCurrentSessionId('s-1')
    useChatStore.getState().setScopeSystemIds([3, 4])
    useChatStore.getState().setOpen(true)

    const raw = localStorage.getItem('chat-ui-state.1')
    expect(raw).not.toBeNull()
    const saved = JSON.parse(raw as string).state
    expect(saved.currentSessionId).toBe('s-1')
    expect(saved.scopeSystemIds).toEqual([3, 4])
    expect(saved).not.toHaveProperty('isOpen')
    expect(localStorage.getItem('chat-ui-state')).toBeNull()
  })

  it('로그인 사용자가 바뀌면 그 사용자 값으로 다시 읽고 패널은 닫힌다', () => {
    loginAs(1)
    useChatStore.getState().setCurrentSessionId('s-1')
    useChatStore.getState().setScopeSystemIds([3])
    useChatStore.getState().setOpen(true)

    // 2번 사용자는 저장된 값이 없다 → 1번 사용자의 상태를 물려받지 않는다
    loginAs(2)
    expect(useChatStore.getState().currentSessionId).toBeNull()
    expect(useChatStore.getState().scopeSystemIds).toBeNull()
    expect(useChatStore.getState().isOpen).toBe(false)

    useChatStore.getState().setCurrentSessionId('s-2')

    // 1번 사용자로 돌아오면 자기 값이 복원된다
    loginAs(1)
    expect(useChatStore.getState().currentSessionId).toBe('s-1')
    expect(useChatStore.getState().scopeSystemIds).toEqual([3])
    expect(useChatStore.getState().isOpen).toBe(false)
  })

  it('로그아웃하면 패널을 닫고 세션·범위를 초기화한다', () => {
    loginAs(1)
    useChatStore.getState().setCurrentSessionId('s-1')
    useChatStore.getState().setScopeSystemIds([3])
    useChatStore.getState().setOpen(true)

    useAuthStore.getState().logout()

    const s = useChatStore.getState()
    expect(s.isOpen).toBe(false)
    expect(s.currentSessionId).toBeNull()
    expect(s.scopeSystemIds).toBeNull()
    // 저장된 사용자 키는 지워지지 않는다(다음 로그인 때 복원)
    expect(localStorage.getItem('chat-ui-state.1')).not.toBeNull()
  })

  it('로그아웃 상태에서는 아무 키에도 저장하지 않는다', () => {
    useChatStore.getState().setCurrentSessionId('s-x')
    expect(Object.keys(localStorage).filter((k) => k.startsWith('chat-ui-state'))).toEqual([])
  })
})
