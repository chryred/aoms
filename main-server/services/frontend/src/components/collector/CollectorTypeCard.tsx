import { Check, Server, Cpu, Database, Settings2 } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { cn } from '@/lib/utils'
import type { CollectorTypeOption } from '@/types/collectorConfig'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Server,
  Cpu,
  Database,
  Settings2,
}

interface CollectorTypeCardProps {
  option: CollectorTypeOption
  selected: boolean
  onSelect: () => void
}

export function CollectorTypeCard({ option, selected, onSelect }: CollectorTypeCardProps) {
  const Icon = ICON_MAP[option.iconName] ?? Server

  return (
    <NeuCard
      pressed={selected}
      onClick={onSelect}
      className={cn(
        'cursor-pointer select-none transition-all',
        'focus-within:ring-2 focus-within:ring-[#6366F1] focus-within:ring-offset-2',
        selected && 'ring-2 ring-[#6366F1]'
      )}
    >
      <button
        type="button"
        className="w-full text-left focus:outline-none"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={option.label}
      >
        <div className="flex items-start justify-between mb-3">
          <Icon
            className={cn(
              'w-8 h-8',
              selected ? 'text-[#6366F1]' : 'text-[#4A5568]'
            )}
          />
          {selected && (
            <Check className="w-4 h-4 text-[#6366F1] flex-shrink-0" aria-hidden="true" />
          )}
        </div>
        <p className="font-semibold text-[#1A1F2E] mb-1">{option.label}</p>
        <p className="text-sm text-[#4A5568]">{option.description}</p>
      </button>
    </NeuCard>
  )
}
