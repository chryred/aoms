import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatSessionSearchInputProps {
  value: string
  onChange: (q: string) => void
  placeholder?: string
  className?: string
}

export function ChatSessionSearchInput({
  value,
  onChange,
  placeholder = '대화 검색...',
  className,
}: ChatSessionSearchInputProps) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className="text-text-secondary pointer-events-none absolute left-3 h-3.5 w-3.5 shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="대화 검색"
        className={cn(
          'bg-bg-base w-full rounded-sm py-2 pr-8 pl-8 text-sm',
          'border-border border',
          'shadow-neu-pressed',
          'text-text-primary placeholder:text-text-disabled',
          'focus:ring-accent focus:ring-1 focus:outline-none',
          'transition-shadow duration-150',
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="검색어 지우기"
          className="text-text-secondary hover:text-text-primary absolute right-2 flex h-4 w-4 items-center justify-center rounded-sm transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
