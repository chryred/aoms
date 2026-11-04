import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { DashboardGrid } from '@/components/apm/live/DashboardGrid'

let trigger: () => void = () => {}
let observed: Element | null = null

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DashboardGrid 폭 측정', () => {
  it('컨테이너 크기가 바뀌면(호스트 목록 접기 등) 다시 재서 그리드 폭에 반영한다', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          trigger = cb
        }
        observe(el: Element) {
          observed = el
        }
        disconnect() {}
      },
    )
    let w = 800
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => w)
    render(
      <DashboardGrid
        widgets={[{ i: 'a', type: 'tps', x: 0, y: 0, w: 6, h: 4 }]}
        locked={false}
        onChange={() => {}}
        renderWidget={() => <span>위젯</span>}
      />,
    )
    const gridEl = () => screen.getByText('위젯').closest('.react-grid-layout') as HTMLElement
    expect(observed).not.toBeNull()
    // 6/12 열 = (800 - 12) / 2 ... 폭에 비례해 위젯 너비가 정해진다
    const before = parseFloat((screen.getByText('위젯').parentElement as HTMLElement).style.width)
    w = 1200
    act(() => trigger())
    const after = parseFloat((screen.getByText('위젯').parentElement as HTMLElement).style.width)
    expect(gridEl()).not.toBeNull()
    expect(after).toBeGreaterThan(before)
  })
})

describe('DashboardGrid 이동·리사이즈', () => {
  const base = { i: 'a', type: 'tps' as const, x: 0, y: 0, w: 6, h: 4 }
  const setup = (locked: boolean, widgets = [base, { ...base, i: 'b', x: 6 }]) => {
    const onChange = vi.fn()
    render(
      <DashboardGrid
        widgets={widgets}
        locked={locked}
        onChange={onChange}
        renderWidget={(w) => (
          <div className="widget-drag-handle" tabIndex={0} data-testid={`h-${w.i}`}>
            {w.i}
          </div>
        )}
      />,
    )
    return onChange
  }

  it('잠금이 아니면 드래그·리사이즈가 켜진다', () => {
    setup(false)
    const item = screen.getByTestId('h-a').closest('.react-grid-item') as HTMLElement
    expect(item.className).toContain('react-draggable')
    expect(item.querySelector('.react-resizable-handle')).not.toBeNull()
  })

  it('잠그면 드래그·리사이즈가 꺼지고 방향키도 무시한다', () => {
    const onChange = setup(true)
    const item = screen.getByTestId('h-a').closest('.react-grid-item') as HTMLElement
    expect(item.className).not.toContain('react-draggable')
    expect(item.closest('[data-locked]')).toHaveAttribute('data-locked', 'true')
    fireEvent.keyDown(screen.getByTestId('h-b'), { key: 'ArrowDown' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('헤더 포커스 + 방향키로 한 칸 이동, 경계를 넘지 않는다', () => {
    const onChange = setup(false)
    fireEvent.keyDown(screen.getByTestId('h-a'), { key: 'ArrowDown' })
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ i: 'a', x: 0, y: 1 })
    fireEvent.keyDown(screen.getByTestId('h-a'), { key: 'ArrowLeft' }) // x=0 에서 왼쪽: 변화 없음
    fireEvent.keyDown(screen.getByTestId('h-b'), { key: 'ArrowRight' }) // x=6,w=6: 이미 오른쪽 끝
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('Shift+방향키로 한 칸 리사이즈, 최소 크기(3x3) 아래로 줄지 않는다', () => {
    const onChange = setup(false, [{ ...base, w: 3, h: 3 }])
    fireEvent.keyDown(screen.getByTestId('h-a'), { key: 'ArrowRight', shiftKey: true })
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ w: 4, h: 3 })
    fireEvent.keyDown(screen.getByTestId('h-a'), { key: 'ArrowLeft', shiftKey: true })
    fireEvent.keyDown(screen.getByTestId('h-a'), { key: 'ArrowUp', shiftKey: true })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
