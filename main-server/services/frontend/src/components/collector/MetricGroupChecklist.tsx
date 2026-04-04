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
                  'bg-[#1E2127] transition-shadow',
                  checked
                    ? 'shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37]'
                    : 'shadow-[2px_2px_5px_#111317,-2px_-2px_5px_#2B2F37]'
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(item.metric_group)}
                  className="mt-0.5 w-4 h-4 accent-[#00D4FF] flex-shrink-0"
                  aria-label={item.metric_group}
                />
                <div>
                  <p className="font-medium text-sm text-[#E2E8F2]">{item.metric_group}</p>
                  <p className="text-xs text-[#8B97AD]">{item.description}</p>
                </div>
              </label>
            )
          })}
        </div>
      )}

      {/* Inline error */}
      {error && <p className="text-xs text-[#EF4444]">{error}</p>}

      {/* Custom added items */}
      {customSelected.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-[#8B97AD]">추가된 항목</p>
          <div className="flex flex-wrap gap-2">
            {customSelected.map((group) => (
              <span
                key={group}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs
                           bg-[rgba(0,212,255,0.10)] text-[#00D4FF]"
              >
                {group}
                <button
                  type="button"
                  onClick={() => onRemove(group)}
                  className="hover:text-[#EF4444] focus:outline-none"
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
      <hr className="border-[#2B2F37]" />

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
