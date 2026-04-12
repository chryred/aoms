import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useSSHSessionStore } from '@/store/sshSessionStore'

describe('sshSessionStore', () => {
  beforeEach(() => {
    useSSHSessionStore.getState().clearSession()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('초기 상태 — 모두 null', () => {
    const s = useSSHSessionStore.getState()
    expect(s.token).toBeNull()
    expect(s.host).toBeNull()
    expect(s.port).toBeNull()
    expect(s.username).toBeNull()
    expect(s.expiresAt).toBeNull()
  })

  it('setSession — 값 저장', () => {
    vi.setSystemTime(new Date('2024-01-01T10:00:00Z'))
    useSSHSessionStore.getState().setSession('tok123', '10.0.0.1', 22, 'admin', 3600)
    const s = useSSHSessionStore.getState()
    expect(s.token).toBe('tok123')
    expect(s.host).toBe('10.0.0.1')
    expect(s.port).toBe(22)
    expect(s.username).toBe('admin')
    expect(s.expiresAt).toBe(new Date('2024-01-01T10:00:00Z').getTime() + 3600 * 1000)
  })

  it('clearSession — 초기화', () => {
    useSSHSessionStore.getState().setSession('tok', 'host', 22, 'user', 60)
    useSSHSessionStore.getState().clearSession()
    const s = useSSHSessionStore.getState()
    expect(s.token).toBeNull()
    expect(s.host).toBeNull()
    expect(s.port).toBeNull()
    expect(s.username).toBeNull()
    expect(s.expiresAt).toBeNull()
  })

  it('isValid — 유효한 세션', () => {
    vi.setSystemTime(new Date('2024-01-01T10:00:00Z'))
    useSSHSessionStore.getState().setSession('tok', 'host', 22, 'user', 3600)
    expect(useSSHSessionStore.getState().isValid()).toBe(true)
  })

  it('isValid — 만료된 세션', () => {
    vi.setSystemTime(new Date('2024-01-01T10:00:00Z'))
    useSSHSessionStore.getState().setSession('tok', 'host', 22, 'user', 3600)
    // 1시간 + 1초 후
    vi.setSystemTime(new Date('2024-01-01T11:00:01Z'))
    expect(useSSHSessionStore.getState().isValid()).toBe(false)
  })

  it('isValid — 토큰 없음', () => {
    expect(useSSHSessionStore.getState().isValid()).toBe(false)
  })
})
