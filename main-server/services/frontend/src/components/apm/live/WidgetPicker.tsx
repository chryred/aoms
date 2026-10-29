import { NeuButton } from '@/components/neumorphic/NeuButton'
import type { WidgetType } from '@/types/apm'
import { MAX_WIDGETS, WIDGET_TYPES, widgetRegistry } from './widgetRegistry'

interface WidgetPickerProps {
  count: number
  onAdd: (type: WidgetType) => void
}

export function WidgetPicker({ count, onAdd }: WidgetPickerProps) {
  const full = count >= MAX_WIDGETS
  return (
    <div className="bg-bg-base shadow-neu-inset mb-4 rounded-sm p-3">
      <div className="text-text-secondary mb-2 text-xs">
        위젯 추가 ({count}/{MAX_WIDGETS}){full && ' — 최대 개수에 도달했습니다'}
      </div>
      <div className="flex flex-wrap gap-2">
        {WIDGET_TYPES.map((type) => (
          <NeuButton
            key={type}
            size="sm"
            variant="secondary"
            disabled={full}
            onClick={() => onAdd(type)}
          >
            {widgetRegistry[type].title} 추가
          </NeuButton>
        ))}
      </div>
    </div>
  )
}
