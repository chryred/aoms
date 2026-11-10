import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { resolveScreen, useScreenContext } from '@/hooks/useScreenContext'
import { useChatContextStore } from '@/store/chatContextStore'

vi.mock('@/hooks/queries/useSystems', () => ({
  useSystems: () => ({ data: [{ id: 3, system_name: 'pay', display_name: '결제' }] }),
}))

describe('resolveScreen — APM 경로', () => {
  it('/apm/live', () => {
    expect(resolveScreen('/apm/live')).toEqual({
      screenKey: 'apm_live',
      screenLabel: '실시간 모니터링',
    })
  })
  it('/apm/transactions', () => {
    expect(resolveScreen('/apm/transactions')).toEqual({
      screenKey: 'apm_transactions',
      screenLabel: '트랜잭션 분석',
    })
  })
  it('/apm/tx/:traceId/:spanId → apm_tx_detail + trace/span', () => {
    expect(resolveScreen('/apm/tx/abc123/span9')).toEqual({
      screenKey: 'apm_tx_detail',
      screenLabel: '트랜잭션 상세',
      traceId: 'abc123',
      spanId: 'span9',
    })
  })
  it('기존 경로는 그대로', () => {
    expect(resolveScreen('/dashboard/3').screenKey).toBe('systems')
    expect(resolveScreen('/incidents/5').screenLabel).toBe('인시던트 상세')
    expect(resolveScreen('/unknown')).toEqual({ screenKey: '', screenLabel: '' })
  })
})

describe('useScreenContext', () => {
  const wrapper = (path: string) =>
    function W({ children }: { children: ReactNode }) {
      return <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    }

  it('트랜잭션 상세: trace_id/span_id + 등록된 system_id 와 system_name 을 담는다', () => {
    useChatContextStore.setState({ contextIds: { system_id: '3' } })
    const { result } = renderHook(() => useScreenContext(), { wrapper: wrapper('/apm/tx/t1/s1') })
    expect(result.current).toEqual({
      screen: 'apm_tx_detail',
      screen_label: '트랜잭션 상세',
      system_id: '3',
      system_name: 'pay',
      trace_id: 't1',
      span_id: 's1',
    })
    useChatContextStore.setState({ contextIds: {} })
  })

  it('등록된 시스템이 없으면 system_id/system_name 을 넣지 않는다', () => {
    useChatContextStore.setState({ contextIds: {} })
    const { result } = renderHook(() => useScreenContext(), { wrapper: wrapper('/apm/live') })
    expect(result.current).toEqual({ screen: 'apm_live', screen_label: '실시간 모니터링' })
  })
})
