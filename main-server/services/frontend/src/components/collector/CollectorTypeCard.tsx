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
        'cursor-pointer transition-all select-none',
        'focus-within:ring-2 focus-within:ring-[#00D4FF] focus-within:ring-offset-2 focus-within:ring-offset-[#1E2127]',
        selected && 'ring-2 ring-[#00D4FF]',
      )}
    >
      <button
        type="button"
        className="w-full text-left focus:outline-none"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={option.label}
      >
        <div className="mb-3 flex items-start justify-between">
          <Icon className={cn('h-8 w-8', selected ? 'text-[#00D4FF]' : 'text-[#8B97AD]')} />
          {selected && (
            <Check className="h-4 w-4 flex-shrink-0 text-[#00D4FF]" aria-hidden="true" />
          )}
        </div>
        <p className="mb-1 font-semibold text-[#E2E8F2]">{option.label}</p>
        <p className="text-sm text-[#8B97AD]">{option.description}</p>
      </button>
    </NeuCard>
  )
}
