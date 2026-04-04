import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  action?: ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="type-heading text-2xl font-bold text-[#E2E8F2]">{title}</h1>
        {description && <p className="mt-1.5 text-sm leading-relaxed text-[#8B97AD]">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
