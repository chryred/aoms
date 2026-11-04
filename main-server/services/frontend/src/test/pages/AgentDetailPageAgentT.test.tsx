import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentDetailPage } from '@/pages/AgentDetailPage'

const sshState = vi.hoisted(() => ({ valid: true }))
vi.mock('@/store/sshSessionStore', () => {
  const state = { token: 'tok', host: '10.0.0.1', isValid: () => sshState.valid, refreshExpiry: vi.fn() }
  const hook = Object.assign(() => state, { getState: () => state })
  return { useSSHSessionStore: hook }
})
vi.mock('@/api/agents', () => ({
  agentsApi: {
    getAgent: vi.fn(),
    getAgents: vi.fn().mockResolvedValue([]),
    updateAgent: vi.fn(),
    installAgent: vi.fn(),
    precheckAgent: vi.fn(),
  },
}))
vi.mock('@/api/apm', () => ({
  apmApi: {
    listThreadDumps: vi.fn().mockResolvedValue([]),
    getThreadDump: vi.fn(),
    requestThreadDump: vi.fn(),
  },
}))
vi.mock('@/hooks/queries/useSystems', () => ({
  useSystems: () => ({ data: [{ id: 1, environment: 'prod' }] }),
}))
vi.mock('@/components/agent/InstallJobMonitor', () => ({
  InstallJobMonitor: ({ onSelectTarget }: { onSelectTarget?: (pid: number) => void }) => (
    <button data-testid="install-monitor" onClick={() => onSelectTarget?.(4242)}>
      pick
    </button>
  ),
}))

import { agentsApi } from '@/api/agents'

const agent = {
  id: 1,
  system_id: 1,
  agent_type: 'agent_t',
  host: '10.0.0.1',
  install_path: '~/agent-t',
  ssh_username: 'jeussic',
  status: 'installed',
  label_info: JSON.stringify({ jvm_match: 'sic_server1', service_type: 'jeus' }),
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/agents/1']}>
        <Routes>
          <Route path="/agents/:id" element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AgentDetailPage — agent_t', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sshState.valid = true
    vi.mocked(agentsApi.getAgent).mockResolvedValue(agent as never)
    vi.mocked(agentsApi.getAgents).mockResolvedValue([])
  })

  it('설치 실행 시 확인 대화상자에 재기동 안내를 표시한다 (운영 강조)', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /설치 실행/ }))
    expect(await screen.findByText(/다음 WAS 재기동부터 기동 옵션으로 적용/)).toBeInTheDocument()
    expect(screen.getByText(/운영 시스템입니다/)).toBeInTheDocument()
    expect(agentsApi.installAgent).not.toHaveBeenCalled()
  })

  it('계측 중지는 label_info 의 다른 키를 유지한 채 enabled=false 로 갱신한다', async () => {
    const user = userEvent.setup()
    vi.mocked(agentsApi.updateAgent).mockResolvedValue(agent as never)
    renderPage()
    await user.click(await screen.findByRole('button', { name: /계측 중지/ }))
    await waitFor(() => expect(agentsApi.updateAgent).toHaveBeenCalled())
    const [id, body] = vi.mocked(agentsApi.updateAgent).mock.calls[0]
    expect(id).toBe(1)
    expect(JSON.parse(body.label_info!)).toEqual({
      jvm_match: 'sic_server1',
      service_type: 'jeus',
      enabled: false,
    })
  })

  it('JVM 선택 시 target_pid 를 담아 설치를 다시 요청한다 (label_info 는 변경하지 않음)', async () => {
    const user = userEvent.setup()
    vi.mocked(agentsApi.installAgent).mockResolvedValue({ job_id: 'j1' } as never)
    renderPage()
    await user.click(await screen.findByRole('button', { name: /설치 실행/ }))
    await user.click(await screen.findByRole('button', { name: '적용' }))
    await user.click(await screen.findByTestId('install-monitor'))
    expect(agentsApi.installAgent).toHaveBeenLastCalledWith(
      { agent_id: 1, target_pid: 4242 },
      'tok',
    )
    expect(agentsApi.updateAgent).not.toHaveBeenCalled()
  })

  it('요청 파라미터 수집 설정을 상세에 표시한다', async () => {
    vi.mocked(agentsApi.getAgent).mockResolvedValue({
      ...agent,
      label_info: JSON.stringify({
        jvm_match: 'x',
        capture_params: true,
        capture_params_include: '/crm/*',
        capture_params_exclude: '/health/*',
      }),
    } as never)
    renderPage()
    expect(await screen.findByText('요청 파라미터 수집')).toBeInTheDocument()
    expect(screen.getByText('/crm/*')).toBeInTheDocument()
    expect(screen.getByText('/health/*')).toBeInTheDocument()
  })

  it('사전 점검 버튼은 SSH 세션이 없으면 비활성화되고 안내를 보인다', async () => {
    sshState.valid = false
    renderPage()
    const btn = await screen.findByRole('button', { name: /사전 점검/ })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'SSH 세션 등록 후 사용 가능')
    expect(agentsApi.precheckAgent).not.toHaveBeenCalled()
  })

  it('사전 점검 실행 시 항목별 결과와 점검 시각을 인라인으로 표시한다 (설치는 호출하지 않음)', async () => {
    const user = userEvent.setup()
    vi.mocked(agentsApi.precheckAgent).mockResolvedValue({
      ok: false,
      overall: 'fail',
      checked_at: '2026-11-05T01:02:03',
      checks: [
        { item: 'JDK', status: 'ok', detail: 'JDK 7' },
        { item: '대상 JVM', status: 'warn', detail: '일치하는 JVM 이 2개입니다' },
        { item: '설치 경로', status: 'fail', detail: '쓰기 권한이 없습니다' },
      ],
    } as never)
    renderPage()
    await user.click(await screen.findByRole('button', { name: /사전 점검/ }))
    expect(agentsApi.precheckAgent).toHaveBeenCalledWith(1, 'tok')
    const result = await screen.findByTestId('precheck-result')
    expect(result).toHaveTextContent('설치가 실패할 수 있습니다')
    expect(result).toHaveTextContent('2026-11-05 10:02 KST')
    expect(screen.getByText('쓰기 권한이 없습니다')).toHaveClass('text-critical')
    expect(screen.getByText('일치하는 JVM 이 2개입니다')).toHaveClass('text-warning')
    expect(agentsApi.installAgent).not.toHaveBeenCalled()
  })

  it('사전 점검 요청이 실패하면 오류 문구를 보인다', async () => {
    const user = userEvent.setup()
    vi.mocked(agentsApi.precheckAgent).mockRejectedValue(new Error('boom'))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /사전 점검/ }))
    expect(await screen.findByText('사전 점검을 실행하지 못했습니다.')).toBeInTheDocument()
  })
})
