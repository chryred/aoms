import { cn } from '@/lib/utils'

interface LoadingSkeletonProps {
  shape?: 'card' | 'table' | 'text'
  count?: number
  className?: string
}

function SkeletonBox({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl bg-[#2B2F37]',
        'animate-pulse',
        className
      )}
    />
  )
}

export function LoadingSkeleton({ shape = 'card', count = 3, className }: LoadingSkeletonProps) {
  if (shape === 'table') {
    return (
      <div className={cn('space-y-3', className)}>
        <SkeletonBox className="h-10 w-full" />
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonBox key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }
  return (
    <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBox key={i} className="h-40 w-full" />
      ))}
    </div>
  )
}
