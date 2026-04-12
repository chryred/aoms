import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentListPage } from '@/pages/AgentListPage'

vi.mock('@/hooks/queries/useAgents', () => ({ useAgents: vi.fn() }))
vi.mock('@/hooks/queries/useSystems', () => ({ useSystems: vi.fn() }))
vi.mock('@/store/sshSessionStore', () => ({
  useSSHSessionStore: vi.fn(),
}))
vi.mock('@/api/agents', () => ({ agentsApi: { deleteSession: vi.fn() } }))
vi.mock('@/components/agent/AgentCard', () => ({
  AgentCard: ({ agent }: { agent: { id: number } }) => (
    <div data-testid="agent-card">에이전트 {agent.id}</div>
  ),
}))
vi.mock('@/components/agent/SSHSessionModal', () => ({
  SSHSessionModal: () => <div data-testid="ssh-modal">SSH 모달</div>,
}))
vi.mock('@/components/agent/AgentFormModal', () => ({
  AgentFormModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="agent-form-modal">에이전트 폼</div> : null,
}))

import { useAgents } from '@/hooks/queries/useAgents'
import { useSystems } from '@/hooks/queries/useSystems'
import { useSSHSessionStore } from '@/store/sshSessionStore'

const mockSystems = [{ id: 1, system_name: 'sys1', display_name: '시스템1' }]
const mockAgents = [
  { id: 1, system_id: 1, agent_type: 'synapse_agent', host: '10.0.0.1', instance_role: 'main' },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AgentListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AgentListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSSHSessionStore).mockReturnValue({
      token: null,
      host: null,
      username: null,
      isValid: () => false,
      clearSession: vi.fn(),
    } as never)
  })

  it('로딩 상태', () => {
    vi.mocked(useAgents).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useSystems).mockReturnValue({ data: undefined, isLoading: true } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('오류 상태', () => {
    vi.mocked(useAgents).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useSystems).mockReturnValue({ data: mockSystems, isLoading: false } as never)
    renderPage()
    expect(screen.getByText(/다시 시도/i)).toBeInTheDocument()
  })

  it('에이전트 목록 표시', () => {
    vi.mocked(useAgents).mockReturnValue({
      data: mockAgents,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useSystems).mockReturnValue({ data: mockSystems, isLoading: false } as never)
    renderPage()
    expect(screen.getByTestId('agent-card')).toBeInTheDocument()
  })

  it('빈 상태', () => {
    vi.mocked(useAgents).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useSystems).mockReturnValue({ data: mockSystems, isLoading: false } as never)
    renderPage()
    expect(screen.getByText(/등록된 에이전트/)).toBeInTheDocument()
  })

  it('SSH 세션 등록 버튼 클릭 → 모달', async () => {
    vi.mocked(useAgents).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useSystems).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    // SSH 세션 등록 버튼 찾기
    const sshBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('SSH'))
    expect(sshBtn).toBeTruthy()
    if (sshBtn) await userEvent.click(sshBtn)
    expect(screen.getByTestId('ssh-modal')).toBeInTheDocument()
  })

  it('세션 활성 시 세션 종료 버튼 표시', () => {
    vi.mocked(useSSHSessionStore).mockReturnValue({
      token: 'tok123',
      host: '10.0.0.1',
      username: 'admin',
      isValid: () => true,
      clearSession: vi.fn(),
    } as never)
    vi.mocked(useAgents).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useSystems).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    expect(screen.getByRole('button', { name: /세션 종료/ })).toBeInTheDocument()
  })
})
