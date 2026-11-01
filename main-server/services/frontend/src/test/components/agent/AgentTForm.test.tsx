import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentFormModal } from '@/components/agent/AgentFormModal'

vi.mock('@/api/agents', () => ({ agentsApi: { createAgent: vi.fn() } }))
vi.mock('@/hooks/queries/useMyPrimarySystems', () => ({
  useMyPrimarySystems: () => ({ data: [{ system_id: 1 }] }),
}))
import { agentsApi } from '@/api/agents'

const systems = [
  {
    id: 1,
    system_name: 'sys1',
    display_name: '시스템1',
    description: null,
    status: 'active' as const,
    teams_webhook_url: null,
    created_at: '',
    updated_at: '',
  },
]

async function openAgentT(user: ReturnType<typeof userEvent.setup>) {
  const qc = new QueryClient()
  render(
    <QueryClientProvider client={qc}>
      <AgentFormModal systems={systems} onClose={vi.fn()} onCreated={vi.fn()} />
    </QueryClientProvider>,
  )
  await user.selectOptions(screen.getAllByRole('combobox')[1], 'agent_t')
  await user.type(screen.getByPlaceholderText('10.0.0.1'), '10.0.0.1')
  await user.type(screen.getByPlaceholderText('예: jeussic'), 'jeussic')
}

describe('AgentTForm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('jvm_match 가 비어 있으면 제출되지 않는다', async () => {
    const user = userEvent.setup()
    await openAgentT(user)
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(agentsApi.createAgent).not.toHaveBeenCalled()
  })

  it('jvm_match 입력 시 agent_t label_info 로 등록한다', async () => {
    const user = userEvent.setup()
    vi.mocked(agentsApi.createAgent).mockResolvedValue({ id: 9 } as never)
    await openAgentT(user)
    await user.type(screen.getByLabelText(/jvm_match/), 'sic_server1')
    await user.click(screen.getByRole('button', { name: '등록' }))
    await waitFor(() => expect(agentsApi.createAgent).toHaveBeenCalled())
    const body = vi.mocked(agentsApi.createAgent).mock.calls[0][0]
    expect(body.agent_type).toBe('agent_t')
    expect(body.install_path).toBe('~/agent-t')
    expect(JSON.parse(body.label_info!)).toMatchObject({
      jvm_match: 'sic_server1',
      install_dir: '~/agent-t',
      immediate: true,
      permanent: true,
    })
  })
})
