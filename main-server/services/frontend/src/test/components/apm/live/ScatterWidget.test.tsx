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

describe('ScatterWidget 범례', () => {
  it('실제 임계값(느린 기준·3배)과 에러 표기를 보여준다', () => {
    renderWidget()
    const legend = screen.getByRole('list', { name: '산점도 범례' })
    expect(legend).toHaveTextContent('정상')
    expect(legend).toHaveTextContent('경고 ≥1s')
    expect(legend).toHaveTextContent('심각 ≥3s')
    expect(legend).toHaveTextContent('에러')
  })

  it('에러는 × 모양, 나머지는 원 견본이다', () => {
    renderWidget()
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-level'))).toEqual([
      'normal',
      'warning',
      'critical',
      'error',
    ])
    expect(items[3].querySelector('[data-shape="error"]')).not.toBeNull()
    for (const li of items.slice(0, 3))
      expect(li.querySelector('[data-shape="dot"]')).not.toBeNull()
    expect(items[3]).toHaveAttribute('title', expect.stringContaining('에러'))
    expect(items[2]).toHaveAttribute('title', expect.stringContaining('느림 (심각)'))
  })
})
