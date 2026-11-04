import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MiniChart } from '@/components/apm/live/widgets/MiniChart'
import { abbreviateLabel, visibleYLabels } from '@/lib/apm/chartLabels'

const pts = (vals: number[]) => vals.map((value, i) => ({ ts: (i + 1) * 1000, value }))

describe('MiniChart 글자 배율', () => {
  const line = [{ label: 'TPS', colorVar: '--t-series-1', points: pts([1, 2]) }]
  it('기본은 축 10px / 범례 12px, scale>1 이면 축 12px / 범례 13px', () => {
    const { rerender } = render(<MiniChart lines={line} />)
    expect(screen.getByTestId('chart-yaxis').style.fontSize).toBe('10px')
    expect(screen.getByTestId('chart-legend').style.fontSize).toBe('12px')
    rerender(<MiniChart lines={line} scale={1.2} />)
    expect(screen.getByTestId('chart-yaxis').style.fontSize).toBe('12px')
    expect(screen.getByTestId('chart-time-axis').style.fontSize).toBe('12px')
    expect(screen.getByTestId('chart-legend').style.fontSize).toBe('13px')
  })
})

describe('MiniChart', () => {
  it('점선 격자 3줄, 면적, 끝점, y 라벨 3개를 그린다', () => {
    render(
      <MiniChart
        lines={[
          { label: 'was1', colorVar: '--t-series-1', points: pts([1, 4, 2]) },
          { label: 'was2', colorVar: '--t-series-2', points: pts([2, 3, 8]) },
        ]}
      />,
    )
    const grid = screen.getAllByTestId('chart-grid')
    expect(grid).toHaveLength(3)
    grid.forEach((g) => expect(g).toHaveAttribute('stroke-dasharray'))
    expect(screen.getAllByTestId('chart-area')).toHaveLength(2)
    const area = screen.getAllByTestId('chart-area')[0]
    expect(area.getAttribute('fill')).toMatch(/^url\(#.+-0\)$/)
    const stops = document.querySelectorAll('linearGradient')[0].querySelectorAll('stop')
    expect(stops[0]).toHaveAttribute('stop-opacity', '0.12')
    expect(stops[1]).toHaveAttribute('stop-opacity', '0.03')
    expect(screen.getAllByTestId('chart-endpoint')).toHaveLength(2)
    expect(screen.getByTestId('chart-ymax')).toHaveTextContent('8.0')
    expect(screen.getByTestId('chart-ymid')).toHaveTextContent('4.0')
    expect(screen.getByTestId('chart-ymin')).toHaveTextContent('0.0')
  })

  it('시리즈가 하나면 위쪽을 더 진하게 하는 세로 그라디언트로 채운다', () => {
    render(<MiniChart lines={[{ label: 'TPS', colorVar: '--t-series-1', points: pts([1, 2]) }]} />)
    const stops = document.querySelector('linearGradient')!.querySelectorAll('stop')
    expect(stops[0]).toHaveAttribute('stop-opacity', '0.28')
    expect(stops[1]).toHaveAttribute('stop-opacity', '0.04')
  })

  it('보조 값(extra)은 범례 행 안에 들어가 별도 행을 만들지 않는다', () => {
    render(
      <MiniChart
        lines={[{ label: 'TPS', colorVar: '--t-series-1', points: pts([1, 2]) }]}
        extra={<span>동시 사용자 3</span>}
      />,
    )
    expect(screen.getByTestId('chart-legend')).toHaveTextContent('동시 사용자 3')
  })

  it('데이터가 없어도 범례 행(고정 높이 슬롯)을 유지한다', () => {
    render(<MiniChart lines={[]} extra="보조" />)
    expect(screen.getByTestId('chart-legend')).toHaveTextContent('보조')
  })

  it('범례에 이름과 마지막 값을 tabular-nums 로 보인다', () => {
    render(<MiniChart lines={[{ label: 'was1', colorVar: '--t-series-1', points: pts([1, 5]) }]} />)
    const legend = screen.getByTestId('chart-legend')
    expect(legend).toHaveTextContent('was1')
    expect(legend.querySelector('.tabular-nums')).toHaveTextContent('5.0')
  })

  it('데이터가 없으면 대기 문구', () => {
    render(<MiniChart lines={[{ label: 'a', colorVar: '--t-series-1', points: [] }]} />)
    expect(screen.getByText('수신 대기')).toBeInTheDocument()
  })
})

describe('MiniChart y축 라벨 간격', () => {
  it('1000ms 이상은 초 단위로 줄인다', () => {
    expect(abbreviateLabel('1079ms')).toBe('1.1s')
    expect(abbreviateLabel('546ms')).toBe('546ms')
    expect(abbreviateLabel('12.5%')).toBe('12.5%')
  })

  it('높이가 모자라면 중간 라벨을 뺀다', () => {
    expect(visibleYLabels(0, 100, 3, 12)).toEqual([true, true, true])
    expect(visibleYLabels(100, 100, 3, 12)).toEqual([true, true, true])
    expect(visibleYLabels(24, 100, 3, 12)).toEqual([true, false, true])
    expect(visibleYLabels(10, 100, 3, 12)[2]).toBe(false)
  })

  it('좁은 축에서는 중간 라벨이 렌더되지 않고 큰 값은 줄여 표시된다', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(24)
    const line = [{ label: '평균', colorVar: '--t-series-1', points: pts([546, 1079]) }]
    render(<MiniChart lines={line} format={(v) => `${Math.round(v)}ms`} />)
    expect(screen.getByTestId('chart-ymax')).toHaveTextContent('1.1s')
    expect(screen.queryByTestId('chart-ymid')).not.toBeInTheDocument()
    spy.mockRestore()
  })
})

describe('MiniChart 호버 툴팁', () => {
  const lines = [
    { label: 'was1', colorVar: '--t-series-1', points: pts([1, 4, 2]) },
    { label: 'was2', colorVar: '--t-series-2', points: pts([2, 3, 8]) },
  ]
  // jsdom 은 레이아웃이 없으므로 플롯 영역을 100x50 로 고정한다
  const mockRect = (el: HTMLElement) =>
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 50,
      width: 100,
      height: 50,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

  it('포인터를 올리면 시각·값이 값 내림차순으로 보이고 떠나면 사라진다', () => {
    render(<MiniChart lines={lines} format={(v) => `${v}tps`} />)
    const plot = screen.getByTestId('chart-hover')
    mockRect(plot)
    expect(screen.queryByTestId('chart-tooltip')).toBeNull()
    // x=100% → 마지막 시각(3000ms = 1970-01-01 09:00:03 KST), y 는 was2(8) 근처(위쪽)
    fireEvent.pointerMove(plot, { clientX: 100, clientY: 2, pointerType: 'mouse' })
    const tip = screen.getByTestId('chart-tooltip')
    expect(tip).toHaveTextContent('09:00:03')
    const rows = screen.getAllByTestId('chart-tooltip-row')
    expect(rows[0]).toHaveTextContent('was2')
    expect(rows[0]).toHaveTextContent('8tps')
    expect(rows[1]).toHaveTextContent('was1')
    expect(rows[1]).toHaveTextContent('2tps')
    expect(rows[0]).toHaveAttribute('data-nearest', 'true')
    expect(tip.className).toContain('pointer-events-none')
    expect(screen.getByTestId('chart-crosshair')).toBeInTheDocument()
    expect(screen.getAllByTestId('chart-hover-dot')).toHaveLength(2)
    fireEvent.pointerMove(plot, { clientX: 0, clientY: 50, pointerType: 'mouse' })
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('09:00:01')
    fireEvent.pointerLeave(plot)
    expect(screen.queryByTestId('chart-tooltip')).toBeNull()
    expect(screen.queryByTestId('chart-crosshair')).toBeNull()
  })

  it('키보드: 좌우 방향키로 시점을 옮기고 Esc 로 숨긴다', () => {
    render(<MiniChart lines={lines} format={(v) => `${v}`} />)
    const plot = screen.getByTestId('chart-hover')
    mockRect(plot)
    expect(plot).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('09:00:03')
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('09:00:02')
    fireEvent.keyDown(plot, { key: 'ArrowRight' })
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('09:00:03')
    fireEvent.keyDown(plot, { key: 'Escape' })
    expect(screen.queryByTestId('chart-tooltip')).toBeNull()
  })

  it('데이터가 없으면 호버 레이어가 없다', () => {
    render(<MiniChart lines={[]} />)
    expect(screen.queryByTestId('chart-hover')).toBeNull()
  })
})
