import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import GridLayout, { type Layout } from 'react-grid-layout/legacy'
import { cn } from '@/lib/utils'
import { applyLayout } from '@/lib/apm/liveData'
import 'react-grid-layout/css/styles.css'
import type { DashboardWidget } from '@/types/apm'
import { GRID_MARGIN, GRID_ROW_HEIGHT } from './defaultLayout'
import { widgetRegistry } from './widgetRegistry'

/** ResizeObserver 가 없는 환경(측정 불가)에서 쓰는 기본 폭 */
const FALLBACK_WIDTH = 1280

interface DashboardGridProps {
  widgets: DashboardWidget[]
  /** true 면 이동·리사이즈(마우스·키보드) 모두 막는다 (화면 잠금) */
  locked: boolean
  /** 드래그/리사이즈가 끝났을 때 새 좌표가 반영된 위젯 배열 */
  onChange: (widgets: DashboardWidget[]) => void
  renderWidget: (w: DashboardWidget) => ReactNode
}

const COLS = 12
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/**
 * 12열 그리드. 잠금이 아니면 위젯 헤더로 이동, 우하단 모서리로 리사이즈한다(별도 모드 없음).
 * 헤더에 포커스가 있으면 방향키로 한 칸 이동, Shift+방향키로 한 칸 리사이즈. 색은 CSS 변수로 테마.
 * react-grid-layout 의 WidthProvider 는 window resize 에만 반응해 사이드바/호스트 목록을
 * 접어 컨테이너 폭만 바뀌면 다시 재지 않는다. 컨테이너를 ResizeObserver 로 직접 잰다.
 */
export function DashboardGrid({ widgets, locked, onChange, renderWidget }: DashboardGridProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(FALLBACK_WIDTH)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = el.offsetWidth
      if (w > 0) setWidth(w)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = widgets.map((w) => {
    const min = widgetRegistry[w.type]?.minSize ?? { w: 3, h: 3 }
    return { i: w.i, x: w.x, y: w.y, w: w.w, h: w.h, minW: min.w, minH: min.h }
  })
  const commit = (next: Layout) => onChange(applyLayout(widgets, next))

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, item: DashboardWidget) => {
    const arrow = ARROWS[e.key]
    const target = e.target as HTMLElement
    if (locked || !arrow || !target.classList.contains('widget-drag-handle')) return
    e.preventDefault()
    const min = widgetRegistry[item.type]?.minSize ?? { w: 3, h: 3 }
    const [dx, dy] = arrow
    let { x, y, w, h } = item
    if (e.shiftKey) {
      w = Math.min(Math.max(w + dx, min.w), COLS - x)
      h = Math.max(h + dy, min.h)
    } else {
      x = Math.min(Math.max(x + dx, 0), COLS - w)
      y = Math.max(y + dy, 0)
    }
    if (x === item.x && y === item.y && w === item.w && h === item.h) return
    onChange(widgets.map((it) => (it.i === item.i ? { ...it, x, y, w, h } : it)))
  }
  return (
    <div
      ref={ref}
      data-locked={locked}
      className={cn(
        '[&_.react-grid-placeholder]:bg-accent-muted! [&_.react-resizable-handle::after]:border-border-alt! [&_.react-grid-item:focus-within_.react-resizable-handle]:opacity-100 [&_.react-grid-item:hover_.react-resizable-handle]:opacity-100 [&_.react-resizable-handle]:opacity-0',
        locked && '[&_.react-resizable-handle]:hidden',
      )}
    >
      <GridLayout
        className="layout"
        width={width}
        layout={layout}
        cols={12}
        rowHeight={GRID_ROW_HEIGHT}
        margin={[GRID_MARGIN, GRID_MARGIN]}
        containerPadding={[0, 0]}
        isDraggable={!locked}
        isResizable={!locked}
        draggableHandle=".widget-drag-handle"
        onDragStop={commit}
        onResizeStop={commit}
      >
        {widgets.map((w) => (
          <div key={w.i} onKeyDown={(e) => onKeyDown(e, w)}>
            {renderWidget(w)}
          </div>
        ))}
      </GridLayout>
    </div>
  )
}
