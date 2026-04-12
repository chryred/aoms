import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAgents, useAgentStatus, useAgentConfig, useInstallJob } from '@/hooks/queries/useAgents'
import { createWrapper } from '../test-utils'
import { useSSHSessionStore } from '@/store/sshSessionStore'

const mockGetAgents = vi.fn()
const mockGetStatus = vi.fn()
const mockGetConfig = vi.fn()
const mockGetInstallJob = vi.fn()

vi.mock('@/api/agents', () => ({
  agentsApi: {
    getAgents: (params: object) => mockGetAgents(params),
    getStatus: (id: number, token: string) => mockGetStatus(id, token),
    getConfig: (id: number, token: string) => mockGetConfig(id, token),
    getInstallJob: (jobId: string) => mockGetInstallJob(jobId),
  },
}))

describe('useAgents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('에이전트 목록 로드', async () => {
    mockGetAgents.mockResolvedValueOnce([{ id: 1 }])
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAgents(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
  })
})

describe('useAgentStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSSHSessionStore.setState({ token: null })
  })

  it('enabled=false → 호출 안 됨', () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAgentStatus(1, false), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(mockGetStatus).not.toHaveBeenCalled()
  })

  it('enabled=true, token 없음 → 호출 안 됨', () => {
    useSSHSessionStore.setState({ token: null })
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAgentStatus(1, true), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('enabled=true, token 있음 → API 호출', async () => {
    useSSHSessionStore.setState({ token: 'ssh-tok' })
    mockGetStatus.mockResolvedValueOnce({ running: true })
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAgentStatus(1, true), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGetStatus).toHaveBeenCalledWith(1, 'ssh-tok')
  })
})

describe('useAgentConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSSHSessionStore.setState({ token: null })
  })

  it('enabled=false → 호출 안 됨', () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAgentConfig(1, false), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('enabled=true, token 있음 → API 호출', async () => {
    useSSHSessionStore.setState({ token: 'ssh-tok' })
    mockGetConfig.mockResolvedValueOnce({ content: '[server]' })
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAgentConfig(1, true), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGetConfig).toHaveBeenCalledWith(1, 'ssh-tok')
  })
})

describe('useInstallJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it('jobId=null → disabled', () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useInstallJob(null, false), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('enabled=true, jobId 있음 → API 호출', async () => {
    mockGetInstallJob.mockResolvedValueOnce({ job_id: 'j1', status: 'running' })
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useInstallJob('j1', true), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGetInstallJob).toHaveBeenCalledWith('j1')
  })
})
