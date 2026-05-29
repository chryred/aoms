import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  action?: ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-y-3">
      <div>
        <h1 className="type-heading text-text-primary text-2xl font-bold">{title}</h1>
        {description && (
          <p className="text-text-secondary mt-1.5 text-sm leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
