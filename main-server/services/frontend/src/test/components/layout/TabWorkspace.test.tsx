import { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation, type Location } from 'react-router-dom'
import { TabWorkspace } from '@/components/layout/tabs/TabWorkspace'
import { useTabActive } from '@/components/layout/tabs/TabContext'
import { MAX_TABS, useTabStore } from '@/store/tabStore'

vi.mock('react-hot-toast', () => ({ default: vi.fn() }))

function Stateful({ name }: { name: string }) {
  const [v, setV] = useState('')
  const active = useTabActive()
  return (
    <div>
      <h1>{name}</h1>
      <span data-testid={`${name}-active`}>{String(active)}</span>
      <input aria-label={`${name}-input`} value={v} onChange={(e) => setV(e.target.value)} />
    </div>
  )
}

const renderRoutes = (location: Location) => (
  <Routes location={location}>
    <Route path="/dashboard" element={<Stateful name="dashboard" />} />
    <Route path="/incidents" element={<Stateful name="incidents" />} />
    <Route path="/alerts" element={<Stateful name="alerts" />} />
    <Route path="/incidents/:id" element={<Stateful name="incident-detail" />} />
    <Route path="/apm/transactions" element={<Stateful name="tx" />} />
    <Route path="/" element={<div>redirect</div>} />
  </Routes>
)

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function Harness({ initial = '/dashboard', ids = [] as number[] }) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <nav>
        <Link to="/dashboard">go-dashboard</Link>
        <Link to="/incidents">go-incidents</Link>
        <Link to="/alerts">go-alerts</Link>
        <Link to="/apm/transactions">go-tx</Link>
        <Link to="/apm/transactions?from=2026-11-04T00:40:00Z&to=2026-11-04T00:42:00Z&min_ms=1">
          go-range-a
        </Link>
        <Link to="/apm/transactions?from=2026-11-04T00:40:00Z&to=2026-11-04T00:42:00Z&min_ms=9">
          go-range-a2
        </Link>
        <Link to="/apm/transactions?from=2026-11-04T01:00:00Z&to=2026-11-04T01:05:00Z">
          go-range-b
        </Link>
        {ids.map((id) => (
          <Link key={id} to={`/incidents/${id}`}>
            go-inc-{id}
          </Link>
        ))}
      </nav>
      <Where />
      <TabWorkspace renderRoutes={renderRoutes} />
    </MemoryRouter>
  )
}

const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent)

beforeEach(() => {
  sessionStorage.clear()
  useTabStore.getState().reset()
})

describe('TabWorkspace', () => {
  it('페이지를 열 때마다 탭이 추가되고 홈 탭이 먼저 온다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(tabNames()).toEqual(['대시보드'])
    await user.click(screen.getByText('go-incidents'))
    await user.click(screen.getByText('go-alerts'))
    expect(tabNames()).toEqual(['대시보드', '인시던트', '알림 이력'])
    expect(screen.getByRole('tab', { name: '알림 이력' })).toHaveAttribute('aria-selected', 'true')
  })

  it('트랜잭션 조회는 from/to 범위마다 별도 탭(KST 제목)이고 같은 범위는 재사용한다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('go-tx'))
    await user.click(screen.getByText('go-range-a'))
    await user.click(screen.getByText('go-range-b'))
    expect(tabNames()).toEqual([
      '대시보드',
      '트랜잭션 분석',
      '트랜잭션 조회 [09:40~09:42]',
      '트랜잭션 조회 [10:00~10:05]',
    ])
    // 같은 범위(다른 min_ms)는 새 탭 없이 기존 탭 활성화 + search 갱신
    await user.click(screen.getByText('go-range-a2'))
    expect(tabNames()).toHaveLength(4)
    expect(screen.getByRole('tab', { name: '트랜잭션 조회 [09:40~09:42]' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(useTabStore.getState().tabs.at(2)!.location.search).toContain('min_ms=9')
    expect(useTabStore.getState().tabs.at(2)!.location.pathname).toBe('/apm/transactions')
  })

  it('이미 열린 탭으로 이동하면 중복 생성 없이 활성화된다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('go-incidents'))
    await user.click(screen.getByText('go-alerts'))
    await user.click(screen.getByText('go-incidents'))
    expect(tabNames()).toEqual(['대시보드', '인시던트', '알림 이력'])
    expect(screen.getByRole('tab', { name: '인시던트' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('where')).toHaveTextContent('/incidents')
  })

  it('탭을 전환해도 각 페이지의 상태(입력값)가 유지되고 비활성 탭은 active=false', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('go-incidents'))
    await user.type(screen.getByLabelText('incidents-input'), 'hello')
    await user.click(screen.getByText('go-alerts'))
    expect(screen.getByLabelText('incidents-input')).not.toBeVisible()
    expect(screen.getByTestId('incidents-active')).toHaveTextContent('false')
    await user.click(screen.getByRole('tab', { name: '인시던트' }))
    expect(screen.getByLabelText('incidents-input')).toBeVisible()
    expect(screen.getByLabelText('incidents-input')).toHaveValue('hello')
    expect(screen.getByTestId('incidents-active')).toHaveTextContent('true')
    expect(screen.getByTestId('where')).toHaveTextContent('/incidents')
  })

  it('활성 탭을 닫으면 이웃 탭이 활성화되고 URL 이 갱신된다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('go-incidents'))
    await user.click(screen.getByText('go-alerts'))
    await user.click(screen.getByRole('tab', { name: '인시던트' }))
    await user.click(screen.getByRole('button', { name: '인시던트 탭 닫기' }))
    expect(tabNames()).toEqual(['대시보드', '알림 이력'])
    expect(screen.getByRole('tab', { name: '알림 이력' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('where')).toHaveTextContent('/alerts')
    // 마지막(오른쪽 끝) 활성 탭을 닫으면 왼쪽 이웃
    await user.click(screen.getByRole('button', { name: '알림 이력 탭 닫기' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard')
  })

  it('비활성 탭은 가운데 클릭으로 닫히고 활성 탭은 유지된다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('go-incidents'))
    await user.click(screen.getByText('go-alerts'))
    const tab = screen.getByRole('tab', { name: '인시던트' }).parentElement!
    tab.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    await screen.findByRole('tab', { name: '알림 이력' })
    expect(tabNames()).toEqual(['대시보드', '알림 이력'])
    expect(screen.getByTestId('where')).toHaveTextContent('/alerts')
  })

  it('대시보드(홈) 탭은 닫을 수 없다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('go-incidents'))
    expect(screen.queryByRole('button', { name: '대시보드 탭 닫기' })).not.toBeInTheDocument()
    expect(useTabStore.getState().closeTab('/dashboard')).toBeNull()
    expect(tabNames()).toContain('대시보드')
  })

  it('모두 닫기는 홈 탭만 남기고 대시보드로 이동한다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('go-incidents'))
    await user.click(screen.getByText('go-alerts'))
    await user.click(screen.getByRole('button', { name: '탭 메뉴' }))
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '모두 닫기' }))
    expect(tabNames()).toEqual(['대시보드'])
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard')
  })

  it('방향키로 탭 포커스를 이동한다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('go-incidents'))
    screen.getByRole('tab', { name: '인시던트' }).focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: '대시보드' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard')
  })

  it(`탭이 ${MAX_TABS}개를 넘으면 가장 오래 쓰지 않은 탭을 닫는다 (홈 제외)`, async () => {
    const user = userEvent.setup()
    const ids = Array.from({ length: MAX_TABS }, (_, i) => i + 1)
    render(<Harness ids={ids} />)
    for (const id of ids) await user.click(screen.getByText(`go-inc-${id}`))
    // 홈 + 12개 시도 → 상한 유지, #1 이 가장 오래돼 제거
    expect(screen.getAllByRole('tab')).toHaveLength(MAX_TABS)
    expect(screen.getByRole('tab', { name: '대시보드' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '인시던트 #1' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: `인시던트 #${MAX_TABS}` })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('열린 탭 목록을 sessionStorage 에 저장하고 새로고침 시 복원한다(지연 마운트)', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness />)
    await user.click(screen.getByText('go-incidents'))
    await user.click(screen.getByText('go-alerts'))
    const saved = JSON.parse(sessionStorage.getItem('synapse.tabs.v1')!)
    expect(saved.map((t: { key: string }) => t.key)).toEqual([
      '/dashboard',
      '/incidents',
      '/alerts',
    ])
    unmount()

    // 새로고침 모사: 모듈을 다시 로드하면 스토어가 sessionStorage 에서 초기화된다
    vi.resetModules()
    const store = await import('@/store/tabStore')
    const ws = await import('@/components/layout/tabs/TabWorkspace')
    expect(store.useTabStore.getState().tabs.map((t) => t.key)).toEqual([
      '/dashboard',
      '/incidents',
      '/alerts',
    ])
    render(
      <MemoryRouter initialEntries={['/alerts']}>
        <ws.TabWorkspace renderRoutes={renderRoutes} />
      </MemoryRouter>,
    )
    expect(tabNames()).toEqual(['대시보드', '인시던트', '알림 이력'])
    expect(screen.getByRole('tab', { name: '알림 이력' })).toHaveAttribute('aria-selected', 'true')
    // 활성화되지 않은 복원 탭은 아직 마운트되지 않는다
    expect(screen.queryByLabelText('incidents-input')).not.toBeInTheDocument()
    expect(screen.getByLabelText('alerts-input')).toBeInTheDocument()
  })
})
