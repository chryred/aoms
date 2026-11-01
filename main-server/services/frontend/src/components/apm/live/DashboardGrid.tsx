import type { ReactNode } from 'react'
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout/legacy'
import { applyLayout } from '@/lib/apm/liveData'
import 'react-grid-layout/css/styles.css'
import type { DashboardWidget } from '@/types/apm'

const Grid = WidthProvider(GridLayout)

interface DashboardGridProps {
  widgets: DashboardWidget[]
  editing: boolean
  /** 드래그/리사이즈가 끝났을 때 새 좌표가 반영된 위젯 배열 */
  onChange: (widgets: DashboardWidget[]) => void
  renderWidget: (w: DashboardWidget) => ReactNode
}

/** 12열 그리드. 편집 모드에서만 이동·리사이즈 가능. 색은 CSS 변수로 테마. */
export function DashboardGrid({ widgets, editing, onChange, renderWidget }: DashboardGridProps) {
  const layout = widgets.map((w) => ({ i: w.i, x: w.x, y: w.y, w: w.w, h: w.h, minW: 2, minH: 3 }))
  const commit = (next: Layout) => onChange(applyLayout(widgets, next))
  return (
    <div className="[&_.react-grid-placeholder]:bg-accent-muted! [&_.react-resizable-handle::after]:border-border-alt!">
      <Grid
        className="layout"
        layout={layout}
        cols={12}
        rowHeight={40}
        margin={[12, 12]}
        isDraggable={editing}
        isResizable={editing}
        draggableHandle=".widget-drag-handle"
        onDragStop={commit}
        onResizeStop={commit}
      >
        {widgets.map((w) => (
          <div key={w.i}>{renderWidget(w)}</div>
        ))}
      </Grid>
    </div>
  )
}
