import { useState } from 'react'
import { X } from 'lucide-react'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { cn } from '@/lib/utils'
import type { CollectorTemplateItem } from '@/types/collectorConfig'

interface MetricGroupChecklistProps {
  items: CollectorTemplateItem[]
  isLoading: boolean
  selected: string[]
  customMetricGroup: string
  onToggle: (group: string) => void
  onAddCustom: (group: string) => void
  onRemove: (group: string) => void
  onCustomChange: (value: string) => void
  error?: string | null
}

export function MetricGroupChecklist({
  items,
  isLoading,
  selected,
  customMetricGroup,
  onToggle,
  onAddCustom,
  onRemove,
  onCustomChange,
  error,
}: MetricGroupChecklistProps) {
  const [inputValue, setInputValue] = useState(customMetricGroup)

  const templateGroups = new Set(items.map((i) => i.metric_group))
  const customSelected = selected.filter((g) => !templateGroups.has(g))

  function handleAdd() {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    onAddCustom(trimmed)
    setInputValue('')
  }

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <LoadingSkeleton shape="card" count={4} />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const checked = selected.includes(item.metric_group)
            return (
              <label
                key={item.metric_group}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-xl cursor-pointer',
                  'bg-[#E8EBF0] transition-shadow',
                  checked
                    ? 'shadow-[inset_3px_3px_6px_#C8CBD4,inset_-3px_-3px_6px_#FFFFFF]'
                    : 'shadow-[3px_3px_6px_#C8CBD4,-3px_-3px_6px_#FFFFFF]'
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(item.metric_group)}
                  className="mt-0.5 w-4 h-4 accent-[#6366F1] flex-shrink-0"
                  aria-label={item.metric_group}
                />
                <div>
                  <p className="font-medium text-sm text-[#1A1F2E]">{item.metric_group}</p>
                  <p className="text-xs text-[#4A5568]">{item.description}</p>
                </div>
              </label>
            )
          })}
        </div>
      )}

      {/* Inline error */}
      {error && <p className="text-xs text-[#DC2626]">{error}</p>}

      {/* Custom added items */}
      {customSelected.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-[#4A5568]">추가된 항목</p>
          <div className="flex flex-wrap gap-2">
            {customSelected.map((group) => (
              <span
                key={group}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs
                           bg-[rgba(99,102,241,0.1)] text-[#4338CA]"
              >
                {group}
                <button
                  type="button"
                  onClick={() => onRemove(group)}
                  className="hover:text-[#DC2626] focus:outline-none"
                  aria-label={`${group} 제거`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Divider */}
      <hr className="border-[#C8CBD4]" />

      {/* Custom input */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <NeuInput
            label="커스텀 메트릭 그룹 추가"
            placeholder="커스텀 metric_group 입력 (예: custom_latency)"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value)
              onCustomChange(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
          />
        </div>
        <NeuButton
          type="button"
          variant="glass"
          onClick={handleAdd}
          disabled={!inputValue.trim()}
          className="mb-0.5"
        >
          추가
        </NeuButton>
      </div>
    </div>
  )
}
