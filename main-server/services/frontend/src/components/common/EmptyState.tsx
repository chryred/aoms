import type { ReactNode } from 'react'
import { NeuButton } from '@/components/neumorphic/NeuButton'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  cta?: { label: string; onClick: () => void }
}

export function EmptyState({ icon, title, description, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="text-[#4A5568]">{icon}</div>
      <div>
        <p className="text-lg font-semibold text-[#1A1F2E]">{title}</p>
        {description && <p className="mt-1 text-sm text-[#4A5568]">{description}</p>}
      </div>
      {cta && <NeuButton onClick={cta.onClick}>{cta.label}</NeuButton>}
    </div>
  )
}
