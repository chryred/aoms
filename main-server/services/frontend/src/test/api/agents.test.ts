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

import { agentsApi } from '@/api/agents'
import { adminApi } from '@/lib/ky-client'
import type { AgentInstallRequest } from '@/types/agent'

function mockReturn(method: 'get' | 'post' | 'patch' | 'delete', value: unknown) {
  vi.mocked(adminApi[method]).mockReturnValue({ json: vi.fn().mockResolvedValue(value) } as never)
}

describe('agentsApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createSession', async () => {
    mockReturn('post', { token: 'ssh-tok', expires_in: 3600 })
    const body = { host: '10.0.0.1', port: 22, username: 'admin', password: 'pass' }
    await agentsApi.createSession(body)
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/ssh/session', { json: body })
  })

  it('deleteSession', async () => {
    vi.mocked(adminApi.delete).mockReturnValue(undefined as never)
    await agentsApi.deleteSession('tok123')
    expect(adminApi.delete).toHaveBeenCalledWith('api/v1/ssh/session', {
      headers: { 'X-SSH-Session': 'tok123' },
    })
  })

  it('getAgents — 파라미터 없이', async () => {
    mockReturn('get', [])
    await agentsApi.getAgents()
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/agents', { searchParams: {} })
  })

  it('getAgents — 필터', async () => {
    mockReturn('get', [])
    await agentsApi.getAgents({ system_id: 1 })
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/agents', { searchParams: { system_id: 1 } })
  })

  it('getAgent', async () => {
    mockReturn('get', { id: 3 })
    await agentsApi.getAgent(3)
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/agents/3')
  })

  it('createAgent', async () => {
    mockReturn('post', { id: 1 })
    const body = {
      system_id: 1,
      host: '10.0.0.1',
      agent_type: 'synapse_agent',
      instance_role: 'main',
    }
    await agentsApi.createAgent(body)
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/agents', { json: body })
  })

  it('updateAgent', async () => {
    mockReturn('patch', {})
    await agentsApi.updateAgent(2, { host: '10.0.0.2' })
    expect(adminApi.patch).toHaveBeenCalledWith('api/v1/agents/2', { json: { host: '10.0.0.2' } })
  })

  it('deleteAgent', async () => {
    vi.mocked(adminApi.delete).mockReturnValue(undefined as never)
    await agentsApi.deleteAgent(4)
    expect(adminApi.delete).toHaveBeenCalledWith('api/v1/agents/4')
  })

  it('startAgent', async () => {
    mockReturn('post', { running: true })
    await agentsApi.startAgent(1, 'ssh-tok')
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/agents/1/start', {
      headers: { 'X-SSH-Session': 'ssh-tok' },
    })
  })

  it('stopAgent', async () => {
    mockReturn('post', { running: false })
    await agentsApi.stopAgent(1, 'ssh-tok')
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/agents/1/stop', {
      headers: { 'X-SSH-Session': 'ssh-tok' },
    })
  })

  it('restartAgent', async () => {
    mockReturn('post', { running: true })
    await agentsApi.restartAgent(1, 'ssh-tok')
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/agents/1/restart', {
      headers: { 'X-SSH-Session': 'ssh-tok' },
    })
  })

  it('getStatus', async () => {
    mockReturn('get', { running: true })
    await agentsApi.getStatus(1, 'ssh-tok')
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/agents/1/status', {
      headers: { 'X-SSH-Session': 'ssh-tok' },
    })
  })

  it('getConfig', async () => {
    mockReturn('get', { content: '' })
    await agentsApi.getConfig(1, 'ssh-tok')
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/agents/1/config', {
      headers: { 'X-SSH-Session': 'ssh-tok' },
    })
  })

  it('uploadConfig', async () => {
    mockReturn('post', { ok: true })
    await agentsApi.uploadConfig(1, 'ssh-tok', '[server]')
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/agents/1/config', {
      json: { config_content: '[server]' },
      headers: { 'X-SSH-Session': 'ssh-tok' },
    })
  })

  it('installAgent', async () => {
    mockReturn('post', { job_id: 'j1' })
    const body: AgentInstallRequest = { agent_id: 1 }
    await agentsApi.installAgent(body, 'ssh-tok')
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/agents/install', {
      json: body,
      headers: { 'X-SSH-Session': 'ssh-tok' },
    })
  })

  it('getInstallJob', async () => {
    mockReturn('get', { job_id: 'j1' })
    await agentsApi.getInstallJob('job-abc')
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/agents/jobs/job-abc')
  })

  it('getLiveStatus', async () => {
    mockReturn('get', { collectors: [] })
    await agentsApi.getLiveStatus(1)
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/agents/1/live-status')
  })
})
