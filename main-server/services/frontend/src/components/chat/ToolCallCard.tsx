import { useState } from 'react'
import { ChevronDown, ChevronRight, Download, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatTools } from '@/hooks/queries/useChatTools'

interface ToolCallCardProps {
  toolName: string
  args?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  running?: boolean
  thought?: string | null
}

function isExportResult(r: unknown): r is { markdown: string; filename: string; export: true } {
  return (
    !!r &&
    typeof r === 'object' &&
    (r as Record<string, unknown>).export === true &&
    typeof (r as Record<string, unknown>).markdown === 'string' &&
    typeof (r as Record<string, unknown>).filename === 'string'
  )
}

function handleExportDownload(result: { markdown: string; filename: string }) {
  const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = result.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function publicArgs(args?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!args) return null
  const filtered: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (k.startsWith('_')) continue
    filtered[k] = v
  }
  return filtered
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
          {(() => {
            const cleanArgs = publicArgs(args)
            if (!cleanArgs || Object.keys(cleanArgs).length === 0) return null
            return (
              <>
                <div className="text-text-secondary mb-1 text-xs">인자</div>
                <pre className="bg-bg-deep mb-2 max-h-48 overflow-auto rounded-[2px] p-2 text-xs">
                  {JSON.stringify(cleanArgs, null, 2)}
                </pre>
              </>
            )
          })()}
          <div className="text-text-secondary mb-1 text-xs">결과</div>
          {!running && isExportResult(result) && (
            <button
              type="button"
              onClick={() => handleExportDownload(result)}
              className="bg-accent text-accent-contrast shadow-neu-flat hover:shadow-neu-pressed focus:ring-accent mb-2 inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-shadow focus:ring-1 focus:outline-none"
              aria-label="Markdown 다운로드"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{result.filename} 다운로드</span>
            </button>
          )}
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
