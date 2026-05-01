import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, Copy, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import type { SearchVerifyResult } from '@/types/knowledge-verify'

// ── 점수 배지 ─────────────────────────────────────────────────────────────────

export function ScoreBadge({ score, kind }: { score: number; kind?: 'sim' | 'rrf' }) {
  const display = kind === 'rrf' ? score.toFixed(4) : `${(score * 100).toFixed(1)}%`
  return (
    <span className="bg-accent-muted text-accent rounded-full px-2 py-0.5 text-xs font-semibold">
      {display}
      {kind && (
        <span className="ml-0.5 text-[10px] font-medium opacity-65">{kind.toUpperCase()}</span>
      )}
    </span>
  )
}

// ── point_id 배지 ─────────────────────────────────────────────────────────────

export function PointIdBadge({ pointId, onClick }: { pointId: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={`point_id: ${pointId}\n클릭하면 상세 보기`}
      className={cn(
        'rounded-sm px-1.5 py-0.5 font-mono text-xs',
        'text-text-disabled bg-bg-base shadow-neu-pressed',
        'hover:text-accent hover:bg-accent-muted transition-colors',
        'focus:ring-accent focus:ring-1 focus:outline-none',
      )}
    >
      #{pointId.slice(0, 8)}
    </button>
  )
}

// ── 삭제 확인 인라인 다이얼로그 ───────────────────────────────────────────────

interface DeleteConfirmProps {
  label: string
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

export function DeleteConfirmInline({ label, onConfirm, onCancel, isPending }: DeleteConfirmProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="text-text-secondary mr-1 text-xs">{label}</span>
      <NeuButton
        variant="ghost"
        size="sm"
        onClick={onConfirm}
        disabled={isPending}
        className="text-critical px-2 text-xs"
      >
        {isPending ? '삭제 중...' : '삭제'}
      </NeuButton>
      <NeuButton
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={isPending}
        className="px-2 text-xs"
      >
        취소
      </NeuButton>
    </div>
  )
}

// ── 마크다운 헬퍼 ─────────────────────────────────────────────────────────────

const URL_FIELDS = new Set(['issue_url', 'page_url', 'url'])

function resolveUrl(fieldKey: string, rawUrl: string): string {
  if (fieldKey === 'url') {
    return rawUrl.replace(/\/pages\/(\d+)$/, '/pages/viewpage.action?pageId=$1')
  }
  return rawUrl
}

function getMetaFields(collection: string): [string, string][] {
  if (collection === 'knowledge_jira_issues') {
    return [
      ['title', '제목'],
      ['issue_key', 'Jira 키'],
      ['issue_url', 'Jira URL'],
      ['source', '출처'],
      ['system_name', '시스템'],
      ['system_id', 'System ID'],
      ['created_at', '생성 시각'],
      ['tags', '태그'],
    ]
  }
  if (collection === 'knowledge_confluence_pages') {
    return [
      ['title', '제목'],
      ['url', 'Confluence URL'],
      ['confluence_id', 'Page ID'],
      ['source', '출처'],
      ['system_name', '시스템'],
      ['system_id', 'System ID'],
      ['chunk_index', '청크'],
      ['created_at', '생성 시각'],
      ['tags', '태그'],
    ]
  }
  if (collection === 'knowledge_documents') {
    return [
      ['file_name', '파일명'],
      ['source', '출처'],
      ['page_number', '페이지'],
      ['slide_number', '슬라이드'],
      ['chunk_index', '청크'],
      ['file_hash', '파일 해시'],
      ['doc_type', '문서 유형'],
      ['system_name', '시스템'],
      ['system_id', 'System ID'],
      ['created_at', '생성 시각'],
      ['tags', '태그'],
      ['source_reference', '출처 참조'],
    ]
  }
  return [
    ['source', '출처'],
    ['system_name', '시스템'],
    ['system_id', 'System ID'],
    ['doc_type', '문서 유형'],
    ['resolved_at', '해결 시각'],
    ['resolved_by', '해결자'],
    ['created_at', '생성 시각'],
    ['tags', '태그'],
    ['source_reference', '출처 참조'],
  ]
}

function normalizeMarkdown(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const trimmed = lines[i].trim()

    if (trimmed.startsWith('||') && trimmed.endsWith('||')) {
      const cells = trimmed.slice(2, -2).split('||')
      result.push('| ' + cells.join(' | ') + ' |')
      result.push('| ' + cells.map(() => '---').join(' | ') + ' |')
      i++
      continue
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|') && !/^\|(\s*[-:]+\s*\|)+$/.test(trimmed)) {
      const tableLines: string[] = [trimmed]
      i++
      while (i < lines.length) {
        const next = lines[i].trim()
        if (next.startsWith('|') && next.endsWith('|')) {
          tableLines.push(next)
          i++
        } else {
          break
        }
      }
      const hasSep = tableLines.some((l) => /^\|(\s*[-:]+\s*\|)+$/.test(l))
      if (!hasSep) {
        const colCount = (tableLines[0].match(/\|/g) ?? []).length - 1
        result.push(tableLines[0])
        result.push('|' + ' --- |'.repeat(colCount))
        result.push(...tableLines.slice(1))
      } else {
        result.push(...tableLines)
      }
      continue
    }

    result.push(lines[i])
    i++
  }

  return result.join('\n')
}

// ── 검색 결과 상세 팝업 ───────────────────────────────────────────────────────

interface SearchResultDetailPanelProps {
  result: SearchVerifyResult
  onClose: () => void
  scoreKind?: 'sim' | 'rrf'
}

export function SearchResultDetailPanel({
  result,
  onClose,
  scoreKind,
}: SearchResultDetailPanelProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleCopy = () => {
    if (!result.point_id) return
    void navigator.clipboard.writeText(result.point_id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const TEXT_FIELDS: [string, string][] = [
    ['content', '본문'],
    ['question', '질문'],
    ['answer', '답변'],
    ['solution', '해결책'],
  ]

  const metaFields = getMetaFields(result.collection)

  const displayedKeys = new Set<string>([
    'collection',
    'score',
    'point_id',
    'tool',
    ...TEXT_FIELDS.map(([k]) => k),
    ...metaFields.map(([k]) => k),
  ])

  const extraFields = Object.entries(result).filter(
    ([k, v]) => !displayedKeys.has(k) && v !== undefined && v !== null && v !== '',
  )

  const hasMetaValues = metaFields.some(([k]) => {
    const v = result[k]
    return v !== undefined && v !== null && v !== ''
  })

  const qdrantPointUrl = result.point_id
    ? `/qdrant/collections/${result.collection}/points/${result.point_id}`
    : null

  return (
    <>
      <div className="bg-overlay fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="검색 결과 상세"
        className={cn(
          'border-border bg-bg-base shadow-neu-flat fixed inset-x-4 top-1/2 z-50 mx-auto max-w-2xl -translate-y-1/2',
          'flex max-h-[85vh] flex-col rounded-sm',
        )}
      >
        {/* 헤더 */}
        <div className="border-border flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-text-secondary bg-surface shadow-neu-pressed rounded-sm px-2 py-0.5 font-mono text-xs">
                {result.collection}
              </span>
              <ScoreBadge score={result.score} kind={scoreKind} />
            </div>
            {result.point_id && (
              <div className="flex items-center gap-2">
                <span className="text-text-disabled shrink-0 text-xs">point_id</span>
                <code className="text-text-primary bg-surface shadow-neu-pressed min-w-0 rounded-sm px-2 py-0.5 font-mono text-xs break-all">
                  {result.point_id}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label="point_id 복사"
                  className={cn(
                    'shrink-0 rounded-sm p-1 transition-colors',
                    'text-text-secondary hover:text-accent hover:bg-accent-muted',
                    'focus:ring-accent focus:ring-1 focus:outline-none',
                  )}
                >
                  {copied ? (
                    <Check className="text-normal h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                {qdrantPointUrl && (
                  <a
                    href={qdrantPointUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Qdrant에서 포인트 조회"
                    className={cn(
                      'shrink-0 rounded-sm p-1 transition-colors',
                      'text-text-secondary hover:text-accent hover:bg-accent-muted',
                      'focus:ring-accent focus:ring-1 focus:outline-none',
                    )}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-text-secondary hover:text-text-primary focus:ring-accent shrink-0 rounded-sm p-1 focus:ring-1 focus:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 본문 */}
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {typeof result.title === 'string' && result.title && (
            <p className="text-text-primary font-semibold">{result.title}</p>
          )}
          {TEXT_FIELDS.map(([key, label]) => {
            const value = result[key]
            if (!value || typeof value !== 'string') return null
            return (
              <div key={key} className="space-y-1.5">
                <p className="text-text-disabled text-sm font-medium">{label}</p>
                <div className="bg-surface shadow-neu-inset max-h-52 overflow-y-auto rounded-sm p-3">
                  <div className="prose text-text-primary [&_p]:text-text-primary [&_li]:text-text-primary [&_td]:text-text-primary [&_th]:text-text-primary [&_td]:border-border [&_th]:border-border [&_strong]:text-text-primary [&_a]:text-accent [&_code]:bg-surface [&_blockquote]:border-border [&_blockquote]:text-text-secondary [&_h1]:text-text-primary [&_h2]:text-text-primary [&_h3]:text-text-primary [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_li]:text-sm [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:text-sm [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_td]:text-sm [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-sm [&_ul]:list-disc [&_ul]:pl-4">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {normalizeMarkdown(value)}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )
          })}

          {hasMetaValues && (
            <div className="space-y-1">
              {metaFields.map(([k, label]) => {
                if (k === 'title') return null
                const v = result[k]
                if (v === undefined || v === null || v === '') return null
                const displayVal = Array.isArray(v) ? (v as unknown[]).join(', ') : String(v)
                return (
                  <div key={k} className="flex items-start gap-3 text-sm">
                    <span className="text-text-disabled w-32 shrink-0 pt-0.5">{label}</span>
                    {URL_FIELDS.has(k) ? (
                      <a
                        href={resolveUrl(k, displayVal)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent flex items-center gap-1 break-all hover:underline"
                      >
                        {resolveUrl(k, displayVal)}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-text-primary break-all">{displayVal}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {extraFields.length > 0 && (
            <div className="border-border space-y-1.5 border-t pt-3">
              <p className="text-text-disabled text-sm font-medium">기타 필드</p>
              <div className="space-y-1">
                {extraFields.map(([k, v]) => (
                  <div key={k} className="flex items-start gap-3 text-sm">
                    <span className="text-text-disabled w-32 shrink-0 pt-0.5 font-mono">{k}</span>
                    <span className="text-text-primary break-all">
                      {typeof v === 'object'
                        ? JSON.stringify(v)
                        : String(v as string | number | boolean)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
