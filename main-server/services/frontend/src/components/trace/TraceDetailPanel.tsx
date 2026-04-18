import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { tracesApi } from '@/api/traces'
import { cn, formatKST } from '@/lib/utils'

const PANEL_TITLE_ID = 'trace-detail-panel-title'

interface TraceDetailPanelProps {
  traceId: string | null
  onClose: () => void
}

interface SpanNode {
  spanId: string
  parentSpanId?: string
  name: string
  startTimeNs: bigint
  durationNs: bigint
  attributes: Record<string, string>
  status?: { code?: number; message?: string }
  children: SpanNode[]
}

function durationLabel(ns: bigint): string {
  const ms = Number(ns) / 1_000_000
  if (ms < 1) return `${(Number(ns) / 1000).toFixed(0)}µs`
  return `${ms.toFixed(1)}ms`
}

function buildTree(spans: SpanNode[]): SpanNode[] {
  const map = new Map<string, SpanNode>()
  for (const s of spans) map.set(s.spanId, s)
  const roots: SpanNode[] = []
  for (const s of spans) {
    if (s.parentSpanId && map.has(s.parentSpanId)) {
      map.get(s.parentSpanId)!.children.push(s)
    } else {
      roots.push(s)
    }
  }
  return roots
}

// 운영 관점에서 바로 쓰이는 attribute key 우선순위 — 있으면 상세 블록에 먼저 노출
const PRIMARY_ATTR_KEYS = [
  'db.statement',
  'db.system',
  'db.name',
  'db.operation',
  'http.method',
  'http.url',
  'http.target',
  'http.route',
  'http.status_code',
  'url.full',
  'url.path',
  'net.peer.name',
  'server.address',
  'server.port',
  'exception.type',
  'exception.message',
  'rpc.service',
  'rpc.method',
  'messaging.system',
  'messaging.destination',
]

function SpanAttributes({ attributes }: { attributes: Record<string, string> }) {
  const keys = Object.keys(attributes)
  if (keys.length === 0) return null
  const primary = PRIMARY_ATTR_KEYS.filter((k) => k in attributes)
  const others = keys.filter((k) => !PRIMARY_ATTR_KEYS.includes(k)).sort()
  const render = (k: string) => {
    const v = attributes[k]
    const isSql = k === 'db.statement'
    return (
      <div key={k} className="border-border/40 flex items-start gap-3 border-b py-1 last:border-b-0">
        <span className="text-text-disabled w-40 shrink-0 font-mono text-[11px]">{k}</span>
        <span
          className={cn(
            'text-text-primary min-w-0 flex-1 font-mono text-[11px] break-all',
            isSql && 'bg-bg-base shadow-neu-inset rounded-sm px-2 py-1 whitespace-pre-wrap',
          )}
        >
          {v || <span className="text-text-disabled italic">(empty)</span>}
        </span>
      </div>
    )
  }
  return (
    <div className="bg-surface/50 mx-4 my-2 rounded-sm border border-dashed border-border p-2">
      {primary.length > 0 && (
        <>
          <p className="text-text-secondary mb-1 text-[10px] font-semibold tracking-wide uppercase">
            주요 속성
          </p>
          {primary.map(render)}
        </>
      )}
      {others.length > 0 && (
        <>
          <p className="text-text-secondary mt-2 mb-1 text-[10px] font-semibold tracking-wide uppercase">
            기타 속성 ({others.length})
          </p>
          {others.map(render)}
        </>
      )}
    </div>
  )
}

function SpanRow({ node, depth, totalNs }: { node: SpanNode; depth: number; totalNs: bigint }) {
  const [open, setOpen] = useState(depth === 0)
  const [showAttrs, setShowAttrs] = useState(false)
  const isError = node.status?.code === 2
  const widthPct = totalNs > 0 ? Math.max(2, Number((node.durationNs * 100n) / totalNs)) : 2
  const attrCount = Object.keys(node.attributes).length

  return (
    <>
      <div
        className={cn(
          'border-border flex cursor-pointer items-center gap-2 border-b py-2 pr-3 text-xs',
          isError && 'bg-[rgba(239,68,68,0.04)]',
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => {
          if (node.children.length > 0) setOpen((p) => !p)
          else if (attrCount > 0) setShowAttrs((p) => !p)
        }}
      >
        <span className="text-text-disabled w-3 shrink-0">
          {node.children.length > 0 ? (open ? '▾' : '▸') : '·'}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-mono',
            isError ? 'text-critical' : 'text-text-primary',
          )}
        >
          {node.name}
        </span>
        {attrCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setShowAttrs((p) => !p)
            }}
            className={cn(
              'hover:bg-hover-subtle shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] transition-colors',
              showAttrs ? 'text-accent bg-accent/10' : 'text-text-disabled',
            )}
            title="속성 보기 (DB SQL, HTTP URL 등)"
          >
            {showAttrs ? '−' : '＋'} attrs
          </button>
        )}
        <div className="bg-border h-2 w-24 shrink-0 overflow-hidden rounded-sm">
          <div
            className={cn('h-full', isError ? 'bg-critical' : 'bg-accent')}
            style={{ width: `${widthPct}%` }}
          />
        </div>
        <span className="text-text-secondary w-16 shrink-0 text-right">
          {durationLabel(node.durationNs)}
        </span>
      </div>
      {showAttrs && <SpanAttributes attributes={node.attributes} />}
      {open &&
        node.children.map((c) => (
          <SpanRow key={c.spanId} node={c} depth={depth + 1} totalNs={totalNs} />
        ))}
    </>
  )
}

function parseSpans(detail: { batches: unknown[] } | undefined): SpanNode[] {
  if (!detail?.batches) return []
  const spans: SpanNode[] = []
  for (const batch of detail.batches as Record<string, unknown>[]) {
    const scopeSpans = (batch.scopeSpans ?? batch.scope_spans ?? []) as Record<string, unknown>[]
    for (const ss of scopeSpans) {
      const rawSpans = (ss.spans ?? []) as Record<string, unknown>[]
      for (const s of rawSpans) {
        const attrs: Record<string, string> = {}
        const rawAttrs = (s.attributes as
          | {
              key: string
              value: {
                stringValue?: string
                intValue?: string | number
                doubleValue?: number
                boolValue?: boolean
                arrayValue?: { values?: Array<{ stringValue?: string }> }
              }
            }[]
          | undefined) ?? []
        for (const kv of rawAttrs) {
          const v = kv.value
          if (!v) {
            attrs[kv.key] = ''
            continue
          }
          if (v.stringValue != null) attrs[kv.key] = v.stringValue
          else if (v.intValue != null) attrs[kv.key] = String(v.intValue)
          else if (v.doubleValue != null) attrs[kv.key] = String(v.doubleValue)
          else if (v.boolValue != null) attrs[kv.key] = String(v.boolValue)
          else if (v.arrayValue?.values) {
            attrs[kv.key] = v.arrayValue.values
              .map((x) => x.stringValue ?? '')
              .join(', ')
          } else attrs[kv.key] = JSON.stringify(v)
        }
        spans.push({
          spanId: s.spanId as string,
          parentSpanId: (s.parentSpanId as string | undefined) || undefined,
          name: (s.name as string) ?? '?',
          startTimeNs: BigInt((s.startTimeUnixNano as string) ?? '0'),
          durationNs:
            BigInt((s.endTimeUnixNano as string) ?? '0') -
            BigInt((s.startTimeUnixNano as string) ?? '0'),
          attributes: attrs,
          status: s.status as SpanNode['status'],
          children: [],
        })
      }
    }
  }
  return spans
}

export function TraceDetailPanel({ traceId, onClose }: TraceDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const open = !!traceId

  const lastTraceIdRef = useRef<string | null>(null)
  if (traceId) lastTraceIdRef.current = traceId
  const displayId = traceId ?? lastTraceIdRef.current

  const { data: detail, isLoading } = useQuery({
    queryKey: ['traceDetail', displayId],
    queryFn: () => tracesApi.getTrace(displayId!),
    enabled: !!displayId,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (!traceId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [traceId, onClose])

  if (!displayId) return null

  const spans = parseSpans(detail as { batches: unknown[] } | undefined)
  const roots = buildTree(spans)
  const totalNs = spans.reduce((acc, s) => (s.durationNs > acc ? s.durationNs : acc), 0n)
  const rootStart = spans.reduce(
    (acc, s) => (s.startTimeNs < acc ? s.startTimeNs : acc),
    spans[0]?.startTimeNs ?? 0n,
  )

  return (
    <>
      <div
        className={cn(
          'bg-overlay fixed inset-0 z-40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={PANEL_TITLE_ID}
        aria-hidden={!open}
        className={cn(
          'border-border bg-bg-base fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[600px] flex-col border-l shadow-[-8px_0_32px_rgba(0,0,0,0.4)] transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <div>
            <p id={PANEL_TITLE_ID} className="text-text-primary text-sm font-semibold">
              Trace 상세
            </p>
            <p className="text-text-secondary mt-0.5 font-mono text-xs">{displayId}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Trace 상세 닫기"
            className="text-text-secondary hover:bg-hover-subtle focus:ring-accent rounded-sm p-1.5 focus:ring-1 focus:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="text-text-secondary flex h-32 items-center justify-center text-sm">
              로딩 중…
            </div>
          ) : spans.length === 0 ? (
            <div className="text-text-secondary flex h-32 items-center justify-center text-sm">
              Span 데이터가 없습니다.
            </div>
          ) : (
            <>
              <div className="border-border flex items-center gap-4 border-b px-6 py-3 text-xs">
                <span className="text-text-secondary">
                  시작:{' '}
                  {formatKST(new Date(Number(rootStart / 1_000_000n)).toISOString(), 'datetime')}
                </span>
                <span className="text-text-secondary">span {spans.length}개</span>
                <span className="text-text-secondary">총 {durationLabel(totalNs)}</span>
              </div>
              <div>
                {roots.map((r) => (
                  <SpanRow key={r.spanId} node={r} depth={0} totalNs={totalNs} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
