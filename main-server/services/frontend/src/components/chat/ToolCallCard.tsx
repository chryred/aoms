import { useState } from 'react'
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ToolCallCardProps {
  toolName: string
  args?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  running?: boolean
  thought?: string | null
}

function summarize(obj: unknown, limit = 160): string {
  if (obj == null) return ''
  try {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj)
    return text.length > limit ? text.slice(0, limit) + '…' : text
  } catch {
    return String(obj).slice(0, limit)
  }
}

export function ToolCallCard({ toolName, args, result, running, thought }: ToolCallCardProps) {
  const [open, setOpen] = useState(false)
  const hasError = result && typeof result === 'object' && 'error' in result

  return (
    <div
      className={cn(
        'bg-surface shadow-neu-flat overflow-hidden rounded-sm text-sm',
        running && 'animate-pulse',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-hover-subtle flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="text-text-secondary h-4 w-4" />
        ) : (
          <ChevronRight className="text-text-secondary h-4 w-4" />
        )}
        <Wrench className={cn('h-4 w-4', hasError ? 'text-critical' : 'text-accent')} />
        <span className="font-medium">{toolName}</span>
        <span className="text-text-secondary flex-1 truncate text-xs">
          {running ? '실행 중…' : hasError ? '오류' : summarize(result)}
        </span>
      </button>
      {open && (
        <div className="border-border border-t px-3 py-2">
          {thought && <div className="text-text-secondary mb-2 text-xs italic">💭 {thought}</div>}
          {args && Object.keys(args).length > 0 && (
            <>
              <div className="text-text-secondary mb-1 text-xs">인자</div>
              <pre className="bg-bg-deep mb-2 max-h-48 overflow-auto rounded-[2px] p-2 text-xs">
                {JSON.stringify(args, null, 2)}
              </pre>
            </>
          )}
          <div className="text-text-secondary mb-1 text-xs">결과</div>
          <pre
            className={cn(
              'bg-bg-deep max-h-64 overflow-auto rounded-[2px] p-2 text-xs',
              hasError && 'text-critical',
            )}
          >
            {running ? '실행 중…' : JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
