import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface NeuCardProps {
  children: ReactNode
  className?: string
  severity?: 'normal' | 'warning' | 'critical'
  pressed?: boolean
  onClick?: () => void
}

export function NeuCard({ children, className, severity, pressed, onClick }: NeuCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl bg-[#E8EBF0] p-6 transition-shadow',
        pressed
          ? 'shadow-[inset_4px_4px_8px_#C8CBD4,inset_-4px_-4px_8px_#FFFFFF]'
          : 'shadow-[6px_6px_12px_#C8CBD4,-6px_-6px_12px_#FFFFFF]',
        severity === 'critical' && 'border-l-4 border-l-[#DC2626] bg-[rgba(220,38,38,0.04)]',
        severity === 'warning' && 'border-l-4 border-l-[#D97706]',
        onClick && 'cursor-pointer hover:shadow-[8px_8px_16px_#C8CBD4,-8px_-8px_16px_#FFFFFF]',
        className
      )}
    >
      {children}
    </div>
  )
}
