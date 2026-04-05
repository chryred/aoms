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
      <div className="text-[#5A6478] opacity-60">{icon}</div>
      <div className="max-w-xs">
        <p className="type-heading text-base font-semibold text-[#E2E8F2]">{title}</p>
        {description && (
          <p className="mt-1.5 text-sm leading-relaxed text-[#8B97AD]">{description}</p>
        )}
      </div>
      {cta && <NeuButton onClick={cta.onClick}>{cta.label}</NeuButton>}
    </div>
  )
}
