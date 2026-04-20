import { useState } from 'react'
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatTools } from '@/hooks/queries/useChatTools'

interface ToolCallCardProps {
  toolName: string
  args?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  running?: boolean
  thought?: string | null
}

export function ToolCallCard({ toolName, args, result, running, thought }: ToolCallCardProps) {
  const [open, setOpen] = useState(false)
  const hasError = result && typeof result === 'object' && 'error' in result
  const { data: tools } = useChatTools()
  const displayName = tools?.find((t) => t.name === toolName)?.display_name

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
          <ChevronDown className="text-text-secondary h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="text-text-secondary h-4 w-4 shrink-0" />
        )}
        <Wrench className={cn('h-4 w-4 shrink-0', hasError ? 'text-critical' : 'text-accent')} />
        <span className="min-w-0 flex-1 truncate font-medium">
          {displayName ? `${displayName}(${toolName})` : toolName}
        </span>
        {running && <span className="text-text-secondary shrink-0 text-xs">실행 중…</span>}
        {!running && hasError && <span className="text-critical shrink-0 text-xs">오류</span>}
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
