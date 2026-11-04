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

  it('요청 파라미터 수집: 체크 시 capture_params 와 포함/제외 URI 를 label_info 에 담는다', async () => {
    const user = userEvent.setup()
    vi.mocked(agentsApi.createAgent).mockResolvedValue({ id: 9 } as never)
    await openAgentT(user)
    await user.type(screen.getByLabelText(/jvm_match/), 'sic_server1')
    expect(screen.queryByLabelText(/포함 URI/)).not.toBeInTheDocument()
    await user.click(screen.getByLabelText(/요청 파라미터 수집/))
    await user.type(screen.getByLabelText(/포함 URI/), '/crm/*, /order/*')
    await user.type(screen.getByLabelText(/제외 URI/), '/health/*')
    await user.click(screen.getByRole('button', { name: '등록' }))
    await waitFor(() => expect(agentsApi.createAgent).toHaveBeenCalled())
    const info = JSON.parse(vi.mocked(agentsApi.createAgent).mock.calls[0][0].label_info!)
    expect(info).toMatchObject({
      capture_params: true,
      capture_params_include: '/crm/*,/order/*',
      capture_params_exclude: '/health/*',
    })
  })

  it('요청 파라미터 수집 미체크: capture_params=false, 포함/제외 키 없음', async () => {
    const user = userEvent.setup()
    vi.mocked(agentsApi.createAgent).mockResolvedValue({ id: 9 } as never)
    await openAgentT(user)
    await user.type(screen.getByLabelText(/jvm_match/), 'sic_server1')
    await user.click(screen.getByRole('button', { name: '등록' }))
    await waitFor(() => expect(agentsApi.createAgent).toHaveBeenCalled())
    const info = JSON.parse(vi.mocked(agentsApi.createAgent).mock.calls[0][0].label_info!)
    expect(info.capture_params).toBe(false)
    expect(info).not.toHaveProperty('capture_params_include')
    expect(info).not.toHaveProperty('capture_params_exclude')
  })

  it('허용되지 않는 문자가 있으면 제출되지 않는다', async () => {
    const user = userEvent.setup()
    await openAgentT(user)
    await user.type(screen.getByLabelText(/jvm_match/), 'sic_server1')
    await user.click(screen.getByLabelText(/요청 파라미터 수집/))
    await user.type(screen.getByLabelText(/포함 URI/), '/crm/*;rm')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(agentsApi.createAgent).not.toHaveBeenCalled()
    expect(screen.getByText(/영문·숫자와/)).toBeInTheDocument()
  })

  it('URI 를 고치면 검증 오류가 바로 사라진다', async () => {
    const user = userEvent.setup()
    await openAgentT(user)
    await user.type(screen.getByLabelText(/jvm_match/), 'sic_server1')
    await user.click(screen.getByLabelText(/요청 파라미터 수집/))
    const include = screen.getByLabelText(/포함 URI/)
    await user.type(include, '/crm/*;rm')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(screen.getByText(/영문·숫자와/)).toBeInTheDocument()
    await user.clear(include)
    await user.type(include, '/crm/*')
    expect(screen.queryByText(/영문·숫자와/)).not.toBeInTheDocument()
  })
})
