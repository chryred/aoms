import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WidgetZoom } from '@/components/apm/live/WidgetZoom'
import { MiniChart } from '@/components/apm/live/widgets/MiniChart'
import { TabActiveContext } from '@/components/layout/tabs/TabContext'

const line = [
  {
    label: 'TPS',
    colorVar: '--t-series-1',
    points: [
      { ts: 1000, value: 1 },
      { ts: 2000, value: 2 },
    ],
  },
]

describe('WidgetZoom', () => {
  it('확대 안에서는 차트 글자가 커지고 대화상자에 경계선·강한 배경이 있다', () => {
    render(
      <WidgetZoom title="TPS" scopeLabel="전체" returnFocusTo={null} onClose={() => {}}>
        <MiniChart lines={line} />
      </WidgetZoom>,
    )
    expect(screen.getByTestId('chart-yaxis').style.fontSize).toBe('12px')
    expect(screen.getByTestId('chart-legend').style.fontSize).toBe('13px')
    expect(screen.getByRole('dialog').className).toContain('border-border-alt')
    expect(screen.getByTestId('widget-zoom-backdrop').className).toContain('bg-overlay-heavy')
  })

  describe('포커스 트랩', () => {
    const renderZoom = () =>
      render(
        <>
          <button>바깥</button>
          <WidgetZoom title="TPS" scopeLabel="전체" returnFocusTo={null} onClose={() => {}}>
            <button>안쪽 버튼</button>
          </WidgetZoom>
        </>,
      )

    it('대화상자가 열리면 포커스가 대화상자로 들어가고 aria-modal 이다', () => {
      renderZoom()
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveFocus()
    })

    it('Tab 은 마지막 요소에서 첫 요소로, Shift+Tab 은 첫 요소에서 마지막 요소로 순환한다', async () => {
      const user = userEvent.setup()
      renderZoom()
      const close = screen.getByRole('button', { name: '닫기' })
      const inner = screen.getByRole('button', { name: '안쪽 버튼' })
      await user.tab()
      expect(close).toHaveFocus()
      await user.tab()
      expect(inner).toHaveFocus()
      await user.tab()
      expect(close).toHaveFocus() // 순환
      await user.tab({ shift: true })
      expect(inner).toHaveFocus() // 역순환
      expect(screen.getByRole('button', { name: '바깥' })).not.toHaveFocus()
    })

    it('Shift+Tab 을 대화상자 자체에서 누르면 마지막 요소로 간다', async () => {
      const user = userEvent.setup()
      renderZoom()
      await user.tab({ shift: true })
      expect(screen.getByRole('button', { name: '안쪽 버튼' })).toHaveFocus()
    })

    it('닫히면(언마운트) 포커스가 돌려받을 요소로 복원된다', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      const { unmount } = render(
        <WidgetZoom title="TPS" scopeLabel="전체" returnFocusTo={opener} onClose={() => {}}>
          <span />
        </WidgetZoom>,
      )
      unmount()
      expect(opener).toHaveFocus()
      opener.remove()
    })
  })

  describe('차트 호버 툴팁', () => {
    const open = (onClose = () => {}) => {
      render(
        <WidgetZoom title="TPS" scopeLabel="전체" returnFocusTo={null} onClose={onClose}>
          <MiniChart lines={line} />
        </WidgetZoom>,
      )
      const plot = screen.getByTestId('chart-hover')
      plot.focus()
      fireEvent.keyDown(plot, { key: 'ArrowLeft' })
      return plot
    }

    it('확대 안에서도 툴팁이 뜨고, 열려 있는 동안 Esc 는 툴팁만 닫는다', () => {
      const onClose = vi.fn()
      const plot = open(onClose)
      expect(screen.getByTestId('chart-tooltip')).toBeInTheDocument()
      fireEvent.keyDown(plot, { key: 'Escape' })
      expect(screen.queryByTestId('chart-tooltip')).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
      // 툴팁이 없을 때의 Esc 는 기존대로 확대를 닫는다
      fireEvent.keyDown(plot, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('탭이 비활성이 되면 툴팁이 사라진다', () => {
      const ui = (active: boolean) => (
        <TabActiveContext.Provider value={active}>
          <MiniChart lines={line} />
        </TabActiveContext.Provider>
      )
      const { rerender } = render(ui(true))
      fireEvent.keyDown(screen.getByTestId('chart-hover'), { key: 'ArrowLeft' })
      expect(screen.getByTestId('chart-tooltip')).toBeInTheDocument()
      rerender(ui(false))
      expect(screen.queryByTestId('chart-tooltip')).toBeNull()
    })
  })
})
