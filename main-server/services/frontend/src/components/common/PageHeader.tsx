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
        <h1 className="text-2xl font-bold text-[#1A1F2E]">{title}</h1>
        {description && <p className="mt-1 text-sm text-[#4A5568]">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
