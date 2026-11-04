import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ScatterWidget } from '@/components/apm/live/widgets/ScatterWidget'

vi.mock('@/hooks/queries/useApmScatter', () => ({
  useApmScatter: () => ({ data: undefined }),
}))

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

function renderWidget(target = { systemIds: [3, 5], instanceRole: 'was1' }) {
  return render(
    <MemoryRouter initialEntries={['/apm/live']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ScatterWidget events={{ points: [] } as never} target={target} slowMs={1000} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

const canvas = () => screen.getByRole('img', { name: '트랜잭션 모니터링' })

describe('ScatterWidget 영역 선택', () => {
  it('드래그하면 범위·스코프가 담긴 트랜잭션 분석 URL 로 이동한다', () => {
    renderWidget()
    fireEvent.mouseDown(canvas(), { clientX: 60, clientY: 20 })
    fireEvent.mouseMove(canvas(), { clientX: 200, clientY: 100 })
    fireEvent.mouseUp(canvas())
    const url = new URL(screen.getByTestId('where').textContent!, 'http://x')
    expect(url.pathname).toBe('/apm/transactions')
    const sp = url.searchParams
    expect(Date.parse(sp.get('from')!)).toBeLessThan(Date.parse(sp.get('to')!))
    expect(sp.get('from')).toMatch(/Z$/)
    expect(Number(sp.get('min_ms'))).toBeLessThan(Number(sp.get('max_ms')))
    expect(sp.getAll('system')).toEqual(['3', '5'])
    expect(sp.get('instance')).toBe('was1')
  })

  it('클릭만 하면 이동하지 않고 선택 목록도 없다', () => {
    renderWidget()
    fireEvent.mouseDown(canvas(), { clientX: 60, clientY: 20 })
    fireEvent.mouseUp(canvas())
    expect(screen.getByTestId('where').textContent).toBe('/apm/live')
    expect(screen.queryByLabelText('선택 영역 트랜잭션')).not.toBeInTheDocument()
  })
})
