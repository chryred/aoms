import type { ReactNode } from 'react'
import { GripVertical, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WidgetFrameProps {
  title: string
  editing: boolean
  onRemove: () => void
  children: ReactNode
}

/** 위젯 공통 카드. 편집 모드에서만 드래그 핸들·삭제 버튼 노출. */
export function WidgetFrame({ title, editing, onRemove, children }: WidgetFrameProps) {
  return (
    <div className="bg-bg-base shadow-neu-flat flex h-full flex-col rounded-sm p-3">
      <div
        className={cn(
          'widget-drag-handle mb-2 flex items-center justify-between',
          editing && 'cursor-move',
        )}
      >
        <span className="text-text-primary flex items-center gap-1 text-sm font-semibold">
          {editing && <GripVertical size={14} className="text-text-tertiary" aria-hidden />}
          {title}
        </span>
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
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
