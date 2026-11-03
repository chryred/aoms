import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InstallJobMonitor } from '@/components/agent/InstallJobMonitor'
import type { AgentInstallJob } from '@/types/agent'

let job: AgentInstallJob
const enabledCalls: [string, boolean][] = []
vi.mock('@/hooks/queries/useAgents', () => ({
  useInstallJob: (jobId: string, enabled: boolean) => {
    enabledCalls.push([jobId, enabled])
    return { data: job }
  },
}))

const base: AgentInstallJob = {
  job_id: 'j1',
  agent_id: 1,
  status: 'needs_target',
  logs: '[1/7] 대상 JVM 탐색\n',
  error: null,
  candidates: [
    { pid: 101, user: 'jeus', command: '/jdk/bin/java -Dsic_server1 weblogic.Server', server_name: 'sic_server1' },
    { pid: 202, user: 'jeus', command: '/jdk/bin/java -Dsic_server1 other', server_name: null },
  ],
  created_at: '2026-11-03T00:00:00',
  updated_at: '2026-11-03T00:00:00',
}

describe('InstallJobMonitor — JVM 선택', () => {
  beforeEach(() => {
    job = base
  })

  it('후보 목록을 표시하고 선택 전에는 설치 버튼이 비활성이다', () => {
    render(<InstallJobMonitor jobId="j1" onSelectTarget={vi.fn()} />)
    expect(screen.getByText(/PID 101 · jeus · sic_server1/)).toBeInTheDocument()
    expect(screen.getByText(/PID 202 · jeus/)).toBeInTheDocument()
    expect(screen.getByText(/-Dsic_server1 other/)).toHaveAttribute('title', base.candidates![1].command)
    expect(screen.getByRole('button', { name: '선택한 JVM 으로 설치' })).toBeDisabled()
  })

  it('선택 후 버튼을 누르면 선택한 PID 로 onSelectTarget 이 호출된다', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<InstallJobMonitor jobId="j1" onSelectTarget={onSelect} />)
    await user.click(screen.getAllByRole('radio')[1])
    await user.click(screen.getByRole('button', { name: '선택한 JVM 으로 설치' }))
    expect(onSelect).toHaveBeenCalledWith(202)
  })

  it('onSelectTarget 이 없거나 후보가 없으면 선택 UI 를 표시하지 않는다', () => {
    const { rerender } = render(<InstallJobMonitor jobId="j1" />)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    job = { ...base, status: 'failed', candidates: null }
    rerender(<InstallJobMonitor jobId="j1" onSelectTarget={vi.fn()} />)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})

describe('InstallJobMonitor — 폴링 중단', () => {
  beforeEach(() => {
    enabledCalls.length = 0
  })

  it('pending/running 동안은 폴링하고, 종료 상태가 되면 멈춘다', () => {
    job = { ...base, status: 'running', candidates: undefined }
    const { rerender } = render(<InstallJobMonitor key="j1" jobId="j1" />)
    expect(enabledCalls.every(([, e]) => e)).toBe(true)

    job = { ...base, status: 'done', candidates: undefined }
    rerender(<InstallJobMonitor key="j1" jobId="j1" />)
    expect(enabledCalls[enabledCalls.length - 1]).toEqual(['j1', false])
  })

  it('failed / needs_target 에서도 멈추고, 새 jobId 는 다시 폴링한다', () => {
    job = { ...base, status: 'failed', candidates: undefined }
    const { rerender } = render(<InstallJobMonitor key="j1" jobId="j1" />)
    expect(enabledCalls[enabledCalls.length - 1]).toEqual(['j1', false])

    job = { ...base, job_id: 'j2', status: 'pending', candidates: undefined }
    rerender(<InstallJobMonitor key="j2" jobId="j2" />)
    expect(enabledCalls[enabledCalls.length - 1]).toEqual(['j2', true])

    job = { ...base, job_id: 'j3', status: 'needs_target' }
    rerender(<InstallJobMonitor key="j3" jobId="j3" />)
    expect(enabledCalls[enabledCalls.length - 1]).toEqual(['j3', false])
  })
})
