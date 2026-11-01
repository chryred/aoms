import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SystemFormDrawer } from '@/components/system/SystemFormDrawer'

const create = vi.fn()
vi.mock('@/hooks/mutations/useCreateSystem', () => ({
  useCreateSystem: () => ({ mutate: create, isPending: false }),
}))
vi.mock('@/hooks/mutations/useUpdateSystem', () => ({
  useUpdateSystem: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useBannerVisible', () => ({ useBannerVisible: () => false }))

async function fillBase(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/시스템 ID/), 'my-sys')
  await user.type(screen.getByLabelText(/표시 이름/), '내 시스템')
}

describe('SystemFormDrawer — Agent-T 필드', () => {
  beforeEach(() => vi.clearAllMocks())

  it('보관일 31 입력 시 오류를 표시하고 제출하지 않는다', async () => {
    const user = userEvent.setup()
    render(<SystemFormDrawer open onClose={vi.fn()} />)
    await fillBase(user)
    const days = screen.getByLabelText(/트랜잭션 보관일/)
    await user.clear(days)
    await user.type(days, '31')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('보관일은 1 ~ 30일 범위로 입력하세요')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('느린 기준(초)을 ms 로 변환해 전송한다', async () => {
    const user = userEvent.setup()
    render(<SystemFormDrawer open onClose={vi.fn()} />)
    await fillBase(user)
    const slow = screen.getByLabelText(/느린 트랜잭션 기준/)
    await user.clear(slow)
    await user.type(slow, '2.5')
    await user.selectOptions(screen.getByLabelText('환경'), 'prod')
    await user.click(screen.getByRole('button', { name: '등록' }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toMatchObject({
      environment: 'prod',
      tx_slow_threshold_ms: 2500,
      tx_retention_days: 7,
    })
  })
})
