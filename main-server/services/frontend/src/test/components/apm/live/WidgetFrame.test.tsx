import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WidgetFrame } from '@/components/apm/live/WidgetFrame'

const setup = () => {
  const onZoom = vi.fn()
  render(
    <WidgetFrame title="목록" editing={false} locked={false} onRemove={() => {}} onZoom={onZoom}>
      <table>
        <tbody>
          <tr>
            <td>행</td>
          </tr>
        </tbody>
      </table>
      <div>차트</div>
    </WidgetFrame>,
  )
  return onZoom
}

describe('WidgetFrame 확대 트리거', () => {
  it('차트 영역 더블클릭은 확대, 표 행 더블클릭은 확대하지 않는다', () => {
    const onZoom = setup()
    fireEvent.doubleClick(screen.getByText('행'))
    expect(onZoom).not.toHaveBeenCalled()
    fireEvent.doubleClick(screen.getByText('차트'))
    expect(onZoom).toHaveBeenCalledTimes(1)
  })

  it('드래그 직후의 더블클릭은 확대로 세지 않는다', () => {
    const onZoom = setup()
    const header = screen.getByRole('group')
    fireEvent.mouseDown(header, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(header, { clientX: 80, clientY: 40 })
    fireEvent.doubleClick(header)
    expect(onZoom).not.toHaveBeenCalled()
  })
})

describe('WidgetFrame 확대 안내', () => {
  it('인라인 안내 문구 없이 확대 버튼 툴팁으로만 안내한다', () => {
    setup()
    expect(screen.queryByTestId('zoom-hint')).toBeNull()
    expect(screen.getByRole('button', { name: '목록 확대' })).toHaveAttribute(
      'title',
      '더블클릭하여 확대',
    )
  })
})
