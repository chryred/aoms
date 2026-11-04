/**
 * ApmLivePage 계열 테스트 공용 키트. 모듈 모의(vi.mock)는 각 테스트 파일 상단에서 선언하고,
 * 여기서는 그 모의 모듈을 가져와 기본값을 심고 매 테스트 뒤에 상태를 비운다.
 */
import { vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toastDefault from 'react-hot-toast'
import { useApmLiveStream as useApmLiveStreamReal } from '@/hooks/useApmLiveStream'
import { apmApi } from '@/api/apm'
import { agentsApi } from '@/api/agents'
import { aggregationsApi } from '@/api/aggregations'
import { systemsApi } from '@/api/systems'
import { TabActiveContext } from '@/components/layout/tabs/TabContext'
import { useAuthStore } from '@/store/authStore'
import { ApmLivePage } from '@/pages/apm/ApmLivePage'
import { LAYOUT_VERSION } from '@/components/apm/live/defaultLayout'
import type { ApmDashboard, DashboardWidget, WidgetType } from '@/types/apm'
import type { LiveData } from '@/hooks/useApmLiveStream'
import type { User } from '@/types/auth'

export const useApmLiveStream = vi.mocked(useApmLiveStreamReal)
export const toast = vi.mocked(toastDefault) as unknown as ReturnType<typeof vi.fn> & {
  success: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

export const agent = (
  id: number,
  system_id: number,
  role: string,
  host: string,
  type = 'agent_t',
) => ({
  id,
  system_id,
  host,
  agent_type: type,
  label_info: JSON.stringify({ instance_role: role }),
})
export const AGENTS = [
  agent(1, 3, 'was1', '10.0.0.1'),
  agent(2, 3, 'was2', '10.0.0.2'),
  agent(3, 4, 'api1', '10.0.1.1'),
  agent(4, 3, 'rust', '10.0.0.9', 'synapse_agent'),
]

export const widget = (i: string, type: WidgetType, y = 0): DashboardWidget => ({
  i,
  type,
  x: 0,
  y,
  w: 4,
  h: 5,
})
export const dashboard = (
  layout: DashboardWidget[],
  over: Partial<ApmDashboard> = {},
): ApmDashboard => ({
  id: 1,
  name: '내 화면',
  layout,
  filters: { layout_version: LAYOUT_VERSION },
  is_shared_default: false,
  owner_user_id: 10,
  updated_at: '2026-10-30T00:00:00',
  ...over,
})

export const emptyLive = (over: Partial<LiveData> = {}): LiveData => ({
  active: new Map(),
  points: [],
  agg: new Map(),
  status: 'open',
  ...over,
})

function fakeCtx() {
  return new Proxy(
    {},
    {
      get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 10 }) : () => {}),
      set: () => true,
    },
  )
}

export function renderPage(url = '/apm/live', tabActive = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TabActiveContext.Provider value={tabActive}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/apm/live" element={<ApmLivePage />} />
            <Route path="/apm/tx/:t/:s" element={<div>상세 이동됨</div>} />
            <Route path="/apm/transactions" element={<div>트랜잭션 분석 이동됨</div>} />
          </Routes>
        </MemoryRouter>
      </TabActiveContext.Provider>
    </QueryClientProvider>,
  )
}

export function installLiveTestHooks() {
  beforeEach(() => {
    localStorage.clear()
    // jsdom 에는 ResizeObserver 가 없다 (react-grid-layout WidthProvider 가 사용)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeCtx() as unknown as CanvasRenderingContext2D,
    )
    useApmLiveStream.mockReturnValue(emptyLive())
    useAuthStore.setState({ user: { id: 10, role: 'operator' } as User, token: 't' })
    vi.mocked(systemsApi.getSystems).mockResolvedValue([
      { id: 3, display_name: '시스템3', system_name: 's3' },
      { id: 4, display_name: '시스템4', system_name: 's4' },
    ] as never)
    vi.mocked(apmApi.listDashboards).mockResolvedValue([
      dashboard([widget('a', 'tps'), widget('b', 'avg_ms', 5)]),
    ])
    vi.mocked(apmApi.updateDashboard).mockResolvedValue(dashboard([]))
    vi.mocked(apmApi.createDashboard).mockResolvedValue(dashboard([], { id: 9, name: '기본 화면' }))
    vi.mocked(agentsApi.getAgents).mockResolvedValue(AGENTS as never)
    vi.mocked(aggregationsApi.getMetricsLiveSummary).mockResolvedValue({})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })
}

export const aggOf = (system_id: number, role: string, tps: number, ts = Date.now()) => ({
  system_id,
  instance_role: role,
  ts,
  tps,
  avg_ms: 100,
  err_rate: 0.01,
  slow_cnt: 0,
  uri_top: [],
  sql_top: [],
  jvm: { cpu_ratio: 0.3 },
  dropped: { detail: 0, sql: 0, tx: 0 },
})
