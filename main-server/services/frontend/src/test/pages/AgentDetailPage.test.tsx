import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentDetailPage } from '@/pages/AgentDetailPage'

vi.mock('@/store/sshSessionStore', () => ({
  useSSHSessionStore: vi.fn(),
}))
vi.mock('@/api/agents', () => ({
  agentsApi: {
    getAgent: vi.fn(),
    getStatus: vi.fn(),
    getLiveStatus: vi.fn(),
    startAgent: vi.fn(),
    stopAgent: vi.fn(),
    restartAgent: vi.fn(),
    getConfig: vi.fn(),
    uploadConfig: vi.fn(),
    deleteAgent: vi.fn(),
    installAgent: vi.fn(),
  },
}))
vi.mock('@/components/agent/SSHSessionModal', () => ({
  SSHSessionModal: ({ open }: { open: boolean }) => (open ? <div data-testid="ssh-modal" /> : null),
}))
vi.mock('@/components/agent/InstallJobMonitor', () => ({
  InstallJobMonitor: () => <div data-testid="install-monitor" />,
}))
vi.mock('@/components/agent/AgentStatusBadge', () => ({
  AgentStatusBadge: () => <span data-testid="agent-status-badge" />,
}))

import { useSSHSessionStore } from '@/store/sshSessionStore'
import { agentsApi } from '@/api/agents'

const mockAgent = {
  id: 1,
  system_id: 1,
  agent_type: 'synapse_agent',
  host: '10.0.0.1',
  instance_role: 'main',
  port: 22,
  username: 'admin',
  install_path: '/opt/synapse',
  status: 'active',
}

function renderPage(agentId = '1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/agents/${agentId}`]}>
        <Routes>
          <Route path="/agents/:id" element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AgentDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSSHSessionStore).mockReturnValue({
      token: null,
      isValid: () => false,
    } as never)
  })

  it('로딩 상태', () => {
    vi.mocked(agentsApi.getAgent).mockReturnValue({ json: () => new Promise(() => {}) } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('SSH 세션 없을 때 잠금 상태', async () => {
    vi.mocked(agentsApi.getAgent).mockResolvedValue(mockAgent as never)
    vi.mocked(agentsApi.getLiveStatus).mockResolvedValue({
      collectors: [],
      live_status: 'no_data',
    } as never)
    renderPage()
    expect(await screen.findByText('10.0.0.1')).toBeInTheDocument()
    // SSH 세션 없으면 SSH 세션 등록 버튼 표시
    const sshBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('SSH'))
    expect(sshBtn).toBeTruthy()
  })
})
