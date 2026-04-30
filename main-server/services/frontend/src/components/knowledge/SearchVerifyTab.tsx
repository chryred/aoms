import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Search,
  Globe,
  ExternalLink,
  RefreshCw,
  Pencil,
  Trash2,
  FileText,
  AlertTriangle,
  Plus,
  TrendingUp,
  Sparkles,
  Info,
  Copy,
  Check,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { EmptyState } from '@/components/common/EmptyState'
import { SystemMultiSelect } from '@/components/chat/SystemMultiSelect'
import { OperatorNoteFormModal } from './OperatorNoteFormModal'
import { useSystems } from '@/hooks/queries/useSystems'
import { useMyPrimarySystems } from '@/hooks/queries/useMyPrimarySystems'
import { useSearchVerifyChatbot, useSearchVerifyCollections } from '@/hooks/queries/useSearchVerify'
import { useDeleteOperatorNote } from '@/hooks/mutations/useKnowledgeMutations'
import { useDeleteDocument } from '@/hooks/mutations/useDeleteDocument'
import { knowledgeApi } from '@/api/knowledge'
import { cn, formatKST, formatRelative, formatPeriodLabel } from '@/lib/utils'
import { ROUTES } from '@/constants/routes'
import {
  ALL_COLLECTIONS,
  KNOWLEDGE_COLLECTIONS,
  COLLECTION_LABELS,
  getCardKind,
} from '@/types/knowledge-verify'
import type { SearchVerifyMode, RagCollection, SearchVerifyResult } from '@/types/knowledge-verify'
import type { OperatorNote } from '@/types/knowledge'
import type { ReportType } from '@/types/report'

// 모드 토글 컴포넌트 (PeriodToggle 패턴 차용)
interface ModeToggleProps {
  value: SearchVerifyMode
  onChange: (mode: SearchVerifyMode) => void
}

function ModeToggle({ value, onChange }: ModeToggleProps) {
  const modes = useMemo<Array<{ key: SearchVerifyMode; label: string }>>(
    () => [
      { key: 'chatbot', label: '챗봇 시뮬레이션' },
      { key: 'collections', label: '컬렉션 직접 검색' },
    ],
    [],
  )
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  useEffect(() => {
    const idx = modes.findIndex((m) => m.key === value)
    const btn = tabRefs.current[idx]
    if (!btn) return
    const { offsetLeft: left, offsetWidth: width } = btn
    setIndicator((prev) => ({ left, width, ready: prev.ready }))
    if (!indicator.ready) {
      requestAnimationFrame(() => setIndicator({ left, width, ready: true }))
    }
  }, [value, indicator.ready, modes])

  return (
    <div
      role="group"
      aria-label="검색 모드 선택"
      className="bg-bg-base shadow-neu-pressed relative flex gap-1 rounded-sm p-1"
    >
      <span
        aria-hidden="true"
        className="shadow-neu-flat bg-accent pointer-events-none absolute rounded-sm"
        style={{
          top: 4,
          bottom: 4,
          left: indicator.left,
          width: indicator.width,
          opacity: indicator.ready ? 1 : 0,
          transition: indicator.ready
            ? 'left 0.22s cubic-bezier(0.25, 1, 0.5, 1), width 0.22s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.12s ease'
            : 'none',
        }}
      />
      {modes.map((mode, i) => (
        <button
          key={mode.key}
          ref={(el) => {
            tabRefs.current[i] = el
          }}
          type="button"
          onClick={() => onChange(mode.key)}
          aria-pressed={value === mode.key}
          className={cn(
            'relative z-10 rounded-sm px-4 py-2 text-sm font-medium whitespace-nowrap',
            'focus:ring-accent focus:ring-1 focus:outline-none',
            'transition-colors duration-150',
            value === mode.key
              ? 'text-accent-contrast font-semibold'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {mode.label}
        </button>
      ))}
    </div>
  )
}

// 삭제 확인 다이얼로그 (인라인 패턴 — NoteRow 방식)
interface DeleteConfirmProps {
  label: string
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function DeleteConfirmInline({ label, onConfirm, onCancel, isPending }: DeleteConfirmProps) {
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

// 점수 배지
function ScoreBadge({ score, kind }: { score: number; kind?: 'sim' | 'rrf' }) {
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

// point_id 뱃지 — 클릭 시 상세 팝업 열기
function PointIdBadge({ pointId, onClick }: { pointId: string; onClick: () => void }) {
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

// Jira 위키 마크업 → GFM 변환 (표 구분선 자동 삽입, ||header|| 처리)
function normalizeMarkdown(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const trimmed = lines[i].trim()

    // Jira header row: ||col1||col2||
    if (trimmed.startsWith('||') && trimmed.endsWith('||')) {
      const cells = trimmed.slice(2, -2).split('||')
      result.push('| ' + cells.join(' | ') + ' |')
      result.push('| ' + cells.map(() => '---').join(' | ') + ' |')
      i++
      continue
    }

    // Pipe table row without separator
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

// 검색 결과 상세 팝업
function SearchResultDetailModal({
  result,
  onClose,
  scoreKind,
}: {
  result: SearchVerifyResult
  onClose: () => void
  scoreKind?: 'sim' | 'rrf'
}) {
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

// 운영자 노트 카드
interface OperatorNoteCardProps {
  result: SearchVerifyResult
  systemName?: string
  onNoteDeleted: () => void
  onNoteEditRequest: (note: OperatorNote) => void
  onDetailClick?: () => void
  scoreKind?: 'sim' | 'rrf'
}

function OperatorNoteCard({
  result,
  systemName,
  onNoteDeleted,
  onNoteEditRequest,
  onDetailClick,
  scoreKind,
}: OperatorNoteCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteNote = useDeleteOperatorNote()

  const handleDelete = () => {
    if (!result.point_id) return
    deleteNote.mutate(result.point_id, { onSuccess: onNoteDeleted })
  }

  const toOperatorNote = (): OperatorNote => ({
    point_id: result.point_id ?? '',
    question: result.question ?? '',
    answer: result.answer ?? '',
    system_id: result.system_id ?? 0,
    tags: Array.isArray(result.tags) ? (result.tags as string[]) : [],
    source_reference: typeof result.source_reference === 'string' ? result.source_reference : null,
    created_by: null,
    created_at: result.created_at ?? '',
  })

  return (
    <NeuCard className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="bg-accent-muted text-accent rounded-sm px-2 py-0.5 text-xs font-medium">
              운영자 노트
            </span>
            {systemName && <span className="text-text-secondary text-xs">{systemName}</span>}
            {result.created_at && (
              <span
                className="text-text-disabled text-xs"
                title={formatKST(result.created_at, 'datetime')}
              >
                {formatRelative(result.created_at)}
              </span>
            )}
            <ScoreBadge score={result.score} kind={scoreKind} />
          </div>
          <p className="text-text-primary text-sm font-medium">{result.question}</p>
          <p className="text-text-secondary mt-1 line-clamp-3 text-sm">{result.answer}</p>
        </div>
      </div>
      <div className="border-border flex items-center border-t pt-2">
        {result.point_id && onDetailClick && (
          <PointIdBadge pointId={result.point_id} onClick={onDetailClick} />
        )}
        <div className="ml-auto flex items-center gap-1">
          {confirmDelete ? (
            <DeleteConfirmInline
              label="정말 삭제할까요?"
              onConfirm={handleDelete}
              onCancel={() => setConfirmDelete(false)}
              isPending={deleteNote.isPending}
            />
          ) : (
            <>
              <NeuButton
                variant="ghost"
                size="sm"
                onClick={() => onNoteEditRequest(toOperatorNote())}
                className="gap-1 px-2 text-xs"
              >
                <Pencil className="h-3 w-3" />
                노트 수정
              </NeuButton>
              <NeuButton
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="text-critical hover:text-critical gap-1 px-2 text-xs"
              >
                <Trash2 className="h-3 w-3" />
                노트 삭제
              </NeuButton>
            </>
          )}
        </div>
      </div>
    </NeuCard>
  )
}

// 문서 청크 카드
interface DocumentChunkCardProps {
  result: SearchVerifyResult
  systemName?: string
  onDeleted: () => void
  onDetailClick?: () => void
  scoreKind?: 'sim' | 'rrf'
}

function DocumentChunkCard({
  result,
  systemName,
  onDeleted,
  onDetailClick,
  scoreKind,
}: DocumentChunkCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteDoc = useDeleteDocument()

  const handleDelete = () => {
    if (!result.file_hash) return
    deleteDoc.mutate(result.file_hash, { onSuccess: onDeleted })
  }

  const locationLabel = result.page_number
    ? `${result.page_number}페이지`
    : result.slide_number
      ? `슬라이드 ${result.slide_number}`
      : result.chunk_index !== undefined
        ? `청크 #${result.chunk_index}`
        : ''

  return (
    <NeuCard className="space-y-2 p-4">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-text-secondary bg-surface shadow-neu-pressed rounded-sm px-2 py-0.5 text-xs">
            <FileText className="mr-0.5 inline h-3 w-3" />
            문서 청크
          </span>
          {systemName && <span className="text-text-secondary text-xs">{systemName}</span>}
          {locationLabel && <span className="text-text-disabled text-xs">{locationLabel}</span>}
          <ScoreBadge score={result.score} kind={scoreKind} />
        </div>
        <p className="text-text-primary text-sm font-medium">{result.file_name}</p>
        {result.content && (
          <p className="text-text-secondary mt-1 line-clamp-3 text-sm">{result.content}</p>
        )}
      </div>
      <div className="border-border flex items-center border-t pt-2">
        {result.point_id && onDetailClick && (
          <PointIdBadge pointId={result.point_id} onClick={onDetailClick} />
        )}
        <div className="ml-auto flex items-center gap-1">
          {confirmDelete ? (
            <DeleteConfirmInline
              label={`"${result.file_name ?? '이 문서'}" 전체 청크를 삭제할까요?`}
              onConfirm={handleDelete}
              onCancel={() => setConfirmDelete(false)}
              isPending={deleteDoc.isPending}
            />
          ) : (
            <NeuButton
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={!result.file_hash}
              className="text-critical hover:text-critical gap-1 px-2 text-xs"
            >
              <Trash2 className="h-3 w-3" />이 문서 전체 삭제
            </NeuButton>
          )}
        </div>
      </div>
    </NeuCard>
  )
}

// Jira/Confluence 카드
interface JiraConfluenceCardProps {
  result: SearchVerifyResult
  onResync: (result: SearchVerifyResult) => void
  onDetailClick?: () => void
  scoreKind?: 'sim' | 'rrf'
  isResyncing?: boolean
}

function JiraConfluenceCard({
  result,
  onResync,
  onDetailClick,
  scoreKind,
  isResyncing = false,
}: JiraConfluenceCardProps) {
  const isJira = result.collection === 'knowledge_jira_issues'
  const title = isJira ? result.issue_key : result.page_title
  const url = isJira ? result.issue_url : result.page_url

  return (
    <NeuCard className="space-y-2 p-4">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="bg-accent-muted text-accent flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-xs font-medium">
            <Globe className="h-3 w-3" />
            전체 지식베이스
          </span>
          <span className="text-text-secondary text-xs">{isJira ? 'Jira' : 'Confluence'}</span>
          <ScoreBadge score={result.score} kind={scoreKind} />
        </div>
        {title && <p className="text-text-primary text-sm font-medium">{title}</p>}
        {result.content && (
          <p className="text-text-secondary mt-1 line-clamp-3 text-sm">{result.content}</p>
        )}
      </div>
      <div className="border-border flex items-center border-t pt-2">
        {result.point_id && onDetailClick && (
          <PointIdBadge pointId={result.point_id} onClick={onDetailClick} />
        )}
        <div className="ml-auto flex items-center gap-1">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'text-accent flex items-center gap-1 rounded-sm px-2 py-1 text-xs',
                'hover:bg-accent-muted focus:ring-accent focus:ring-1 focus:outline-none',
              )}
            >
              <ExternalLink className="h-3 w-3" />
              원본 보기
            </a>
          )}
          <NeuButton
            variant="ghost"
            size="sm"
            onClick={() => onResync(result)}
            disabled={isResyncing}
            className="gap-1 px-2 text-xs"
          >
            <RefreshCw className={cn('h-3 w-3', isResyncing && 'animate-spin')} />
            {isResyncing ? '동기화 중...' : '강제 재동기화'}
          </NeuButton>
        </div>
      </div>
    </NeuCard>
  )
}

// 집계 요약 / 시간별 패턴 카드
interface AggregationVerifyCardProps {
  result: SearchVerifyResult
  systemName?: string
  onDetailClick?: () => void
  scoreKind?: 'sim' | 'rrf'
}

function AggregationVerifyCard({
  result,
  systemName,
  onDetailClick,
  scoreKind,
}: AggregationVerifyCardProps) {
  const collectionLabel =
    result.collection === 'aggregation_summaries' ? '집계 요약' : '시간별 패턴'

  const displayedSystemName =
    systemName || (result.system_name as string | undefined) || '시스템 미지정'

  const dominantSeverity = result.dominant_severity as string | undefined

  const severityClass =
    dominantSeverity === 'critical'
      ? 'text-critical-text bg-critical-bg'
      : dominantSeverity === 'warning'
        ? 'text-warning-text bg-warning-bg'
        : dominantSeverity === 'normal'
          ? 'text-normal-text bg-normal-bg'
          : null

  const severityLabel =
    dominantSeverity === 'critical'
      ? '위험'
      : dominantSeverity === 'warning'
        ? '경고'
        : dominantSeverity === 'normal'
          ? '정상'
          : null

  // 기간 레이블: period_type + period_start → formatPeriodLabel, metric_hourly_patterns는 formatKST
  let periodLabel: string | null = null
  const periodType = result.period_type as string | undefined
  const periodStart = result.period_start as string | undefined
  if (periodStart) {
    if (result.collection === 'aggregation_summaries' && periodType) {
      try {
        periodLabel = formatPeriodLabel(periodType as ReportType, periodStart)
      } catch {
        periodLabel = formatKST(periodStart, 'date')
      }
    } else {
      periodLabel = formatKST(periodStart, 'datetime')
    }
  }

  const rawBody =
    (result.summary_text as string | undefined) ?? (result.content as string | undefined) ?? null
  // summary_text 형식: "시스템:xxx 날짜:xxx | 수집기:xxx | 집계시간:Nh 이상:Mh | ..."
  // 시스템/날짜는 헤더에 이미 표시되므로 해당 세그먼트 제거
  const bodyText = rawBody
    ? rawBody
        .split(' | ')
        .filter((seg) => !seg.startsWith('시스템:'))
        .join(' | ') || null
    : null

  const llmTrend = result.llm_trend as string | undefined
  const llmPrediction = result.llm_prediction as string | undefined

  return (
    <NeuCard className="space-y-2 p-4">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="bg-warning-bg text-warning-text rounded-sm px-2 py-0.5 text-xs font-medium">
            {collectionLabel}
          </span>
          <span className="text-text-secondary text-xs">{displayedSystemName}</span>
          {periodLabel && <span className="text-text-disabled text-xs">{periodLabel}</span>}
          {severityClass && severityLabel && (
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', severityClass)}>
              {severityLabel}
            </span>
          )}
          <ScoreBadge score={result.score} kind={scoreKind} />
        </div>
        {bodyText && <p className="text-text-secondary mt-1 line-clamp-3 text-sm">{bodyText}</p>}
        {llmTrend && (
          <div className="mt-2 flex items-start gap-1.5">
            <TrendingUp className="text-text-secondary mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-text-secondary text-sm">{llmTrend}</p>
          </div>
        )}
        {llmPrediction && (
          <div className="mt-1 flex items-start gap-1.5">
            <Sparkles className="text-text-secondary mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-text-secondary text-sm">{llmPrediction}</p>
          </div>
        )}
      </div>
      {result.point_id && onDetailClick && (
        <div className="border-border flex items-center border-t pt-2">
          <PointIdBadge pointId={result.point_id} onClick={onDetailClick} />
        </div>
      )}
    </NeuCard>
  )
}

// 로그 장애 / 메트릭 기준선 카드
interface IncidentCardProps {
  result: SearchVerifyResult
  systemName?: string
  originalQuery: string
  onDetailClick?: () => void
  scoreKind?: 'sim' | 'rrf'
}

function IncidentCard({
  result,
  systemName,
  originalQuery,
  onDetailClick,
  scoreKind,
}: IncidentCardProps) {
  const navigate = useNavigate()
  const collectionLabel = result.collection === 'metric_baselines' ? '메트릭 기준선' : '로그 장애'

  const displayedSystemName =
    systemName || (result.system_name as string | undefined) || '시스템 미지정'

  const handleFeedbackSearch = () => {
    const params = new URLSearchParams()
    if (result.system_id) params.set('system_id', String(result.system_id))
    if (originalQuery.trim()) params.set('q', originalQuery.trim())
    const qs = params.toString()
    navigate(qs ? `${ROUTES.FEEDBACK_SEARCH}?${qs}` : ROUTES.FEEDBACK_SEARCH)
  }

  return (
    <NeuCard className="space-y-2 p-4">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="bg-warning-bg text-warning-text rounded-sm px-2 py-0.5 text-xs font-medium">
            {collectionLabel}
          </span>
          <span className="text-text-secondary text-xs">{displayedSystemName}</span>
          {result.resolved_at && (
            <span
              className="text-text-disabled text-xs"
              title={formatKST(result.resolved_at, 'datetime')}
            >
              {formatKST(result.resolved_at, 'datetime')}
            </span>
          )}
          <ScoreBadge score={result.score} kind={scoreKind} />
        </div>
        {result.content && (
          <p className="text-text-secondary mt-1 line-clamp-3 text-sm">{result.content}</p>
        )}
        {result.solution && (
          <p className="text-text-primary mt-1 line-clamp-3 text-sm">{result.solution}</p>
        )}
      </div>
      <div className="border-border flex items-center border-t pt-2">
        {result.point_id && onDetailClick && (
          <PointIdBadge pointId={result.point_id} onClick={onDetailClick} />
        )}
        <div className="ml-auto flex items-center gap-1">
          <NeuButton
            variant="ghost"
            size="sm"
            onClick={handleFeedbackSearch}
            className="gap-1 px-2 text-xs"
          >
            <Search className="h-3 w-3" />
            해결책 검색
          </NeuButton>
        </div>
      </div>
    </NeuCard>
  )
}

// 결과 카드 — 컬렉션에 따라 분기
interface ResultCardProps {
  result: SearchVerifyResult
  systemName?: string
  originalQuery: string
  onNoteDeleted: () => void
  onNoteEditRequest: (note: OperatorNote) => void
  onDocDeleted: () => void
  onResync: (result: SearchVerifyResult) => void
  onDetailClick?: () => void
  scoreKind?: 'sim' | 'rrf'
  isResyncing?: boolean
}

function ResultCard({
  result,
  systemName,
  originalQuery,
  onNoteDeleted,
  onNoteEditRequest,
  onDocDeleted,
  onResync,
  onDetailClick,
  scoreKind,
  isResyncing = false,
}: ResultCardProps) {
  const kind = getCardKind(result)

  if (kind === 'operator_note') {
    return (
      <OperatorNoteCard
        result={result}
        systemName={systemName}
        onNoteDeleted={onNoteDeleted}
        onNoteEditRequest={onNoteEditRequest}
        onDetailClick={onDetailClick}
        scoreKind={scoreKind}
      />
    )
  }
  if (kind === 'document_chunk') {
    return (
      <DocumentChunkCard
        result={result}
        systemName={systemName}
        onDeleted={onDocDeleted}
        onDetailClick={onDetailClick}
        scoreKind={scoreKind}
      />
    )
  }
  if (kind === 'jira_confluence') {
    return (
      <JiraConfluenceCard
        result={result}
        onResync={onResync}
        onDetailClick={onDetailClick}
        scoreKind={scoreKind}
        isResyncing={isResyncing}
      />
    )
  }
  // incident_metric: aggregation / hourly → AggregationVerifyCard, 그 외 → IncidentCard
  if (
    result.collection === 'aggregation_summaries' ||
    result.collection === 'metric_hourly_patterns'
  ) {
    return (
      <AggregationVerifyCard
        result={result}
        systemName={systemName}
        onDetailClick={onDetailClick}
        scoreKind={scoreKind}
      />
    )
  }
  return (
    <IncidentCard
      result={result}
      systemName={systemName}
      originalQuery={originalQuery}
      onDetailClick={onDetailClick}
      scoreKind={scoreKind}
    />
  )
}

// 컬렉션 체크박스 그룹
interface CollectionCheckboxGroupProps {
  selected: RagCollection[]
  onChange: (collections: RagCollection[]) => void
}

function CollectionCheckboxGroup({ selected, onChange }: CollectionCheckboxGroupProps) {
  const toggle = (col: RagCollection) => {
    if (selected.includes(col)) {
      onChange(selected.filter((c) => c !== col))
    } else {
      onChange([...selected, col])
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-text-secondary text-sm font-medium">컬렉션 선택</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {ALL_COLLECTIONS.map((col) => {
          const checked = selected.includes(col)
          return (
            <label
              key={col}
              htmlFor={`collection-${col}`}
              className="flex cursor-pointer items-center gap-1.5 text-sm"
            >
              <span
                className={cn(
                  'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border',
                  checked ? 'border-accent bg-accent' : 'border-border bg-bg-base',
                )}
                aria-hidden="true"
              >
                {checked && (
                  <svg className="text-accent-contrast h-3 w-3" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <input
                type="checkbox"
                id={`collection-${col}`}
                name={`collection-${col}`}
                className="sr-only"
                checked={checked}
                onChange={() => toggle(col)}
              />
              <span
                className={cn('font-mono', checked ? 'text-text-primary' : 'text-text-secondary')}
              >
                {COLLECTION_LABELS[col]}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ───── 메인 컴포넌트 ─────────────────────────────────────────────────────────

export function SearchVerifyTab() {
  const { data: systems = [] } = useSystems()
  const { data: primarySystems } = useMyPrimarySystems()

  // 상태
  const [mode, setMode] = useState<SearchVerifyMode>('chatbot')
  const [selectedSystems, setSelectedSystems] = useState<number[]>([])
  const [selectedCollections, setSelectedCollections] = useState<RagCollection[]>([
    ...ALL_COLLECTIONS,
  ])
  const [useReranker, setUseReranker] = useState(false)
  const [query, setQuery] = useState('')
  const [editNote, setEditNote] = useState<OperatorNote | null>(null)
  const [addNoteOpen, setAddNoteOpen] = useState(false)
  const [results, setResults] = useState<SearchVerifyResult[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [detailResult, setDetailResult] = useState<SearchVerifyResult | null>(null)
  const [resyncingIds, setResyncingIds] = useState<Set<string>>(new Set())

  const searchChatbot = useSearchVerifyChatbot()
  const searchCollections = useSearchVerifyCollections()

  const isPending = searchChatbot.isPending || searchCollections.isPending
  const isError = searchChatbot.isError || searchCollections.isError

  const scoreKind: 'sim' | 'rrf' = mode === 'chatbot' ? 'sim' : 'rrf'

  // 담당 시스템 자동 체크 — 최초 1회만 (useRef 게이트로 재초기화 방지)
  const primarySystemsInitialized = useRef(false)
  useEffect(() => {
    if (!primarySystemsInitialized.current && primarySystems && primarySystems.length > 0) {
      primarySystemsInitialized.current = true
      setSelectedSystems(primarySystems.map((p) => p.system_id))
    }
  }, [primarySystems])

  // Reranker: knowledge_* 컬렉션 미선택 또는 챗봇 모드면 비활성
  const hasKnowledgeCollection = selectedCollections.some((c) => KNOWLEDGE_COLLECTIONS.includes(c))
  const rerankerEnabled = mode === 'collections' && hasKnowledgeCollection

  useEffect(() => {
    if (!rerankerEnabled) setUseReranker(false)
  }, [rerankerEnabled])

  // 시스템명 조회 헬퍼
  const getSystemName = useCallback(
    (systemId?: number) => {
      if (!systemId) return undefined
      return systems.find((s) => s.id === systemId)?.display_name
    },
    [systems],
  )

  const handleSearch = () => {
    if (!query.trim()) return

    if (mode === 'chatbot') {
      searchChatbot.mutate(
        { query: query.trim(), system_ids: selectedSystems },
        {
          onSuccess: (data) => {
            setResults(data.results)
            setHasSearched(true)
          },
        },
      )
    } else {
      searchCollections.mutate(
        {
          query: query.trim(),
          system_ids: selectedSystems,
          collections: selectedCollections,
          use_reranker: rerankerEnabled && useReranker,
        },
        {
          onSuccess: (data) => {
            setResults(data.results)
            setHasSearched(true)
          },
        },
      )
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSearch()
    }
  }

  const handleResultsRefresh = () => {
    if (!hasSearched || !query.trim()) return
    handleSearch()
  }

  const handleResync = async (result: SearchVerifyResult) => {
    const id = result.point_id
    if (!id) return

    setResyncingIds((prev) => new Set(prev).add(id))
    try {
      if (result.collection === 'knowledge_jira_issues') {
        const issueKey = (result.jira_key ?? result.issue_key) as string | undefined
        if (!issueKey) {
          toast.error('이슈 키를 찾을 수 없습니다')
          return
        }
        await knowledgeApi.forceSyncJiraIssue(issueKey)
        toast.success(`Jira 이슈 재동기화 완료: ${issueKey}`)
      } else if (result.collection === 'knowledge_confluence_pages') {
        const pageId = (result.confluence_id ?? result.page_id) as string | undefined
        if (!pageId) {
          toast.error('페이지 ID를 찾을 수 없습니다')
          return
        }
        const res = await knowledgeApi.forceSyncConfluencePage(pageId)
        toast.success(`Confluence 페이지 재동기화 완료 (${res.synced_chunks}청크)`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '재동기화 실패')
    } finally {
      setResyncingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <div className="space-y-4">
      {/* 검색 설정 영역 */}
      <NeuCard className="space-y-4 p-4">
        {/* 모드 토글 */}
        <ModeToggle value={mode} onChange={setMode} />

        {/* 시스템 다중 선택 */}
        <div className="space-y-1.5">
          <SystemMultiSelect
            value={selectedSystems}
            onChange={setSelectedSystems}
            systems={systems}
            label="시스템 필터"
            placeholder="시스템 선택 (미선택 시 전체)"
          />
          <p className="text-text-secondary flex items-center gap-1 text-sm">
            <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
            Jira/Confluence는 시스템 무관 전체 조회됩니다
          </p>
        </div>

        {/* 컬렉션 선택 (컬렉션 직접 검색 모드만) */}
        {mode === 'collections' && (
          <>
            <CollectionCheckboxGroup
              selected={selectedCollections}
              onChange={setSelectedCollections}
            />

            {/* Reranker 토글 */}
            <div className="flex items-center gap-3">
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-2 text-sm',
                  !rerankerEnabled && 'cursor-not-allowed opacity-40',
                )}
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={useReranker}
                  aria-label="Reranker 적용"
                  disabled={!rerankerEnabled}
                  onClick={() => rerankerEnabled && setUseReranker((v) => !v)}
                  className={cn(
                    'focus:ring-accent relative h-5 w-9 rounded-full border transition-colors focus:ring-1 focus:outline-none',
                    useReranker && rerankerEnabled
                      ? 'border-accent bg-accent'
                      : 'border-border bg-bg-base',
                  )}
                >
                  <span
                    className={cn(
                      'shadow-neu-flat absolute top-0.5 h-4 w-4 rounded-full transition-transform duration-150',
                      useReranker && rerankerEnabled
                        ? 'bg-accent-contrast left-4'
                        : 'bg-text-disabled left-0.5',
                    )}
                  />
                </button>
                <span
                  className={cn(
                    'text-sm',
                    rerankerEnabled ? 'text-text-primary' : 'text-text-disabled',
                  )}
                >
                  Reranker 적용
                </span>
              </label>
              {!rerankerEnabled && (
                <span className="text-text-disabled text-xs">
                  (knowledge_* 컬렉션 선택 시 활성화)
                </span>
              )}
            </div>
          </>
        )}

        {/* 쿼리 입력 */}
        <div className="space-y-2">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder="검색할 질의를 입력하세요 (Ctrl+Enter로 검색)"
            className={cn(
              'bg-bg-base text-text-primary placeholder:text-text-disabled',
              'shadow-neu-inset w-full rounded-sm px-3 py-2 text-sm',
              'focus:ring-accent focus:ring-1 focus:outline-none',
              'resize-none',
            )}
          />
          <div className="flex items-center justify-end">
            <NeuButton
              onClick={handleSearch}
              disabled={!query.trim() || isPending}
              loading={isPending}
              className="gap-2"
            >
              <Search className="h-4 w-4" />
              검색
            </NeuButton>
          </div>
        </div>
      </NeuCard>

      {/* 결과 영역 */}
      {isPending && <LoadingSkeleton shape="card" count={3} />}

      {isError && !isPending && <ErrorCard onRetry={handleResultsRefresh} />}

      {!isPending && !isError && hasSearched && results.length === 0 && (
        <EmptyState
          icon={<Search className="text-text-secondary h-10 w-10" />}
          title="검색 결과가 없습니다"
          description="다른 키워드나 컬렉션으로 다시 시도해보세요."
        />
      )}

      {!isPending && !isError && results.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-text-secondary text-sm">
              검색 결과 <span className="text-text-primary font-semibold">{results.length}</span>건
            </p>
          </div>
          <div className="space-y-3">
            {results.map((result, idx) => (
              <ResultCard
                key={`${result.collection}-${result.point_id ?? idx}`}
                result={result}
                systemName={getSystemName(result.system_id)}
                originalQuery={query}
                onNoteDeleted={handleResultsRefresh}
                onNoteEditRequest={setEditNote}
                onDocDeleted={handleResultsRefresh}
                onResync={handleResync}
                onDetailClick={result.point_id ? () => setDetailResult(result) : undefined}
                scoreKind={scoreKind}
                isResyncing={resyncingIds.has(result.point_id ?? '')}
              />
            ))}
          </div>

          {/* 운영자 노트 추가 진입점 */}
          <div className="border-border mt-2 border-t pt-4">
            <NeuButton
              variant="ghost"
              onClick={() => setAddNoteOpen(true)}
              className="text-accent gap-2 text-sm"
            >
              <Plus className="h-4 w-4" />이 검색어로 운영자 노트 추가
            </NeuButton>
          </div>
        </>
      )}

      {/* 운영자 노트 수정 모달 */}
      {editNote && (
        <OperatorNoteFormModal
          note={editNote}
          onClose={() => setEditNote(null)}
          onSaved={() => {
            setEditNote(null)
            handleResultsRefresh()
          }}
        />
      )}

      {/* 운영자 노트 추가 모달 (검색어 prefill) */}
      {addNoteOpen && (
        <OperatorNoteFormModal
          prefillQuestion={query}
          onClose={() => setAddNoteOpen(false)}
          onSaved={() => {
            setAddNoteOpen(false)
            handleResultsRefresh()
          }}
        />
      )}

      {/* 검색 결과 상세 팝업 */}
      {detailResult && (
        <SearchResultDetailModal
          result={detailResult}
          onClose={() => setDetailResult(null)}
          scoreKind={scoreKind}
        />
      )}

      {/* 결과 없을 때도 첫 진입 상태면 안내 */}
      {!isPending && !isError && !hasSearched && (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <AlertTriangle className="text-text-disabled h-10 w-10" />
          <p className="text-text-secondary text-sm">질의를 입력하고 검색 버튼을 누르세요</p>
        </div>
      )}
    </div>
  )
}
