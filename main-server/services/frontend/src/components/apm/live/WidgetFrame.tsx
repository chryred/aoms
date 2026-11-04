import { useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { GripVertical, Maximize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WidgetFrameProps {
  title: string
  /** 위젯 추가/삭제 모드: 삭제 버튼 노출 */
  editing: boolean
  /** 화면 잠금: 헤더가 이동 핸들이 아니게 된다 */
  locked: boolean
  onRemove: () => void
  /** 확대 요청. 닫을 때 포커스를 돌려줄 헤더 요소를 함께 넘긴다 */
  onZoom?: (returnFocusTo: HTMLElement | null) => void
  children: ReactNode
}

/** 위젯 공통 카드. 헤더(제목줄)가 드래그 핸들(잠금 시 해제), 삭제 버튼은 편집 모드에서만. */
/** 이 요소 안에서의 더블클릭은 자체 동작이 있으므로 확대하지 않는다 */
const NO_ZOOM = 'tr, a, button, select, input, textarea, [role="button"], [data-no-zoom]'
/** 드래그가 끝난 직후(ms)의 더블클릭은 확대로 세지 않는다 */
const DRAG_GRACE_MS = 500
const DRAG_PX = 4

export function WidgetFrame({
  title,
  editing,
  locked,
  onRemove,
  onZoom,
  children,
}: WidgetFrameProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  const down = useRef<{ x: number; y: number } | null>(null)
  const dragEnd = useRef(0)
  const zoom = () => onZoom?.(headerRef.current)

  const onMouseDown = (e: MouseEvent) => {
    down.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseUp = (e: MouseEvent) => {
    const d = down.current
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_PX) dragEnd.current = Date.now()
    down.current = null
  }
  const onDoubleClick = (e: MouseEvent) => {
    if (!onZoom || (e.target as HTMLElement).closest(NO_ZOOM)) return
    if (Date.now() - dragEnd.current < DRAG_GRACE_MS) return
    zoom()
  }
  const onHeaderKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.target === e.currentTarget && onZoom) {
      e.preventDefault()
      zoom()
    }
  }

  return (
    <div
      className="bg-bg-base shadow-neu-soft flex h-full flex-col rounded-sm px-3 py-2.5"
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={headerRef}
        role="group"
        tabIndex={0}
        onKeyDown={onHeaderKeyDown}
        aria-label={
          locked
            ? `${title} (Enter로 확대)`
            : `${title} 위치·크기 조정 (방향키 이동, Shift+방향키 크기, Enter로 확대)`
        }
        className={cn(
          'widget-drag-handle focus-visible:ring-accent mb-1 flex h-6 shrink-0 items-center gap-2 rounded-sm focus-visible:ring-1 focus-visible:outline-none',
          !locked && 'cursor-grab active:cursor-grabbing',
        )}
      >
        {/* 삭제 버튼은 헤더 왼쪽에 둔다: 오른쪽 아래에 떠 있는 AI 어시스턴트 버튼에 가려지지 않게 */}
        {editing && (
          <button
            type="button"
            aria-label={`${title} 삭제`}
            onClick={onRemove}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-text-secondary hover:text-critical-text rounded-sm p-1"
          >
            <X size={14} />
          </button>
        )}
        <span className="text-text-primary flex min-w-0 items-center gap-1 text-sm font-semibold">
          {!locked && (
            <GripVertical size={14} className="text-text-tertiary shrink-0" aria-hidden />
          )}
          <span className="truncate">{title}</span>
        </span>
        {onZoom && (
          <button
            type="button"
            aria-label={`${title} 확대`}
            title="더블클릭하여 확대"
            onClick={zoom}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-text-secondary hover:text-text-primary focus-visible:ring-accent ml-auto shrink-0 rounded-sm p-1 focus-visible:ring-1 focus-visible:outline-none"
          >
            <Maximize2 size={13} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
