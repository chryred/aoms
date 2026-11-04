import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatSql, tokenizeSql } from '@/lib/apm/sqlFormat'
import type { SqlTokenType } from '@/lib/apm/sqlFormat'

const TOKEN_CLASS: Record<SqlTokenType, string> = {
  keyword: 'text-sql-keyword font-semibold',
  function: 'text-sql-function',
  string: 'text-sql-string',
  bind: 'text-sql-bind font-semibold',
  comment: 'text-sql-comment italic',
  number: 'text-sql-bind',
  text: 'text-text-primary',
}

const BTN =
  'text-text-tertiary hover:text-text-primary hover:bg-hover-subtle focus-visible:ring-accent inline-flex min-h-[28px] items-center gap-1 rounded-sm px-2 text-xs focus-visible:ring-1 focus-visible:outline-none'

/** 선택된 표시 방식: 세그먼트 컨트롤의 눌린 면 + 본문 색 텍스트 */
const ACTIVE =
  'bg-bg-base text-text-primary shadow-neu-pressed font-semibold hover:text-text-primary'

export function SqlViewer({ sql }: { sql: string }) {
  const [formatted, setFormatted] = useState(true)
  const [copied, setCopied] = useState(false)
  const shown = useMemo(() => (formatted ? formatSql(sql) : sql), [formatted, sql])
  const tokens = useMemo(() => tokenizeSql(shown), [shown])
  const lineCount = useMemo(() => shown.split('\n').length, [shown])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 클립보드 권한 없음: 무시 */
    }
  }

  return (
    <div className="bg-sql-bg border-border max-w-full min-w-0 rounded-sm border">
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1">
        <div role="group" aria-label="SQL 표시 방식" className="flex gap-1">
          <button
            type="button"
            aria-pressed={formatted}
            onClick={() => setFormatted(true)}
            className={cn(BTN, formatted && ACTIVE)}
          >
            정렬
          </button>
          <button
            type="button"
            aria-pressed={!formatted}
            onClick={() => setFormatted(false)}
            className={cn(BTN, !formatted && ACTIVE)}
          >
            원문
          </button>
        </div>
        <button type="button" onClick={copy} className={BTN} aria-live="polite">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? '복사됨' : '복사'}
        </button>
      </div>
      <div className="flex max-h-[420px] overflow-auto font-mono text-xs leading-5">
        <div
          aria-hidden="true"
          className="text-sql-lineno border-border bg-sql-bg sticky left-0 shrink-0 border-r px-2 text-right select-none"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <pre
          data-testid="sql-code"
          className="m-0 min-w-0 flex-1 px-3 whitespace-pre"
          tabIndex={0}
          aria-label="SQL 본문"
        >
          {tokens.map((t, i) => (
            <span key={i} className={TOKEN_CLASS[t.type]}>
              {t.text}
            </span>
          ))}
        </pre>
      </div>
    </div>
  )
}
