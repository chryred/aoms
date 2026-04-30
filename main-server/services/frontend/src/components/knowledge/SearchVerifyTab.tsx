import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
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
function ScoreBadge({ score }: { score: number }) {
  const pct = `${(score * 100).toFixed(1)}%`
  return (
    <span className="bg-accent-muted text-accent rounded-full px-2 py-0.5 text-[11px] font-semibold">
      {pct}
    </span>
  )
}

// 운영자 노트 카드
interface OperatorNoteCardProps {
  result: SearchVerifyResult
  systemName?: string
  onNoteDeleted: () => void
  onNoteEditRequest: (note: OperatorNote) => void
}

function OperatorNoteCard({
  result,
  systemName,
  onNoteDeleted,
  onNoteEditRequest,
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
            <span className="bg-accent-muted text-accent rounded-sm px-2 py-0.5 text-[11px] font-medium">
              운영자 노트
            </span>
            {systemName && <span className="text-text-secondary text-[11px]">{systemName}</span>}
            {result.created_at && (
              <span
                className="text-text-disabled text-[11px]"
                title={formatKST(result.created_at, 'datetime')}
              >
                {formatRelative(result.created_at)}
              </span>
            )}
            <ScoreBadge score={result.score} />
          </div>
          <p className="text-text-primary text-sm font-medium">{result.question}</p>
          <p className="text-text-secondary mt-1 line-clamp-3 text-xs">{result.answer}</p>
        </div>
      </div>
      <div className="border-border flex items-center justify-end gap-1 border-t pt-2">
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
    </NeuCard>
  )
}

// 문서 청크 카드
interface DocumentChunkCardProps {
  result: SearchVerifyResult
  systemName?: string
  onDeleted: () => void
}

function DocumentChunkCard({ result, systemName, onDeleted }: DocumentChunkCardProps) {
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
          <span className="text-text-secondary bg-surface shadow-neu-pressed rounded-sm px-2 py-0.5 text-[11px]">
            <FileText className="mr-0.5 inline h-3 w-3" />
            문서 청크
          </span>
          {systemName && <span className="text-text-secondary text-[11px]">{systemName}</span>}
          {locationLabel && <span className="text-text-disabled text-[11px]">{locationLabel}</span>}
          <ScoreBadge score={result.score} />
        </div>
        <p className="text-text-primary text-sm font-medium">{result.file_name}</p>
        {result.content && (
          <p className="text-text-secondary mt-1 line-clamp-3 text-xs">{result.content}</p>
        )}
      </div>
      <div className="border-border flex items-center justify-end gap-1 border-t pt-2">
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
    </NeuCard>
  )
}

// Jira/Confluence 카드
interface JiraConfluenceCardProps {
  result: SearchVerifyResult
  onResync: (result: SearchVerifyResult) => void
}

function JiraConfluenceCard({ result, onResync }: JiraConfluenceCardProps) {
  const isJira = result.collection === 'knowledge_jira_issues'
  const title = isJira ? result.issue_key : result.page_title
  const url = isJira ? result.issue_url : result.page_url

  return (
    <NeuCard className="space-y-2 p-4">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="bg-accent-muted text-accent flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium">
            <Globe className="h-3 w-3" />
            전체 지식베이스
          </span>
          <span className="text-text-secondary text-[11px]">{isJira ? 'Jira' : 'Confluence'}</span>
          <ScoreBadge score={result.score} />
        </div>
        {title && <p className="text-text-primary text-sm font-medium">{title}</p>}
        {result.content && (
          <p className="text-text-secondary mt-1 line-clamp-3 text-xs">{result.content}</p>
        )}
      </div>
      <div className="border-border flex items-center justify-end gap-1 border-t pt-2">
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
          className="gap-1 px-2 text-xs"
        >
          <RefreshCw className="h-3 w-3" />
          강제 재동기화
        </NeuButton>
      </div>
    </NeuCard>
  )
}

// 집계 요약 / 시간별 패턴 카드
interface AggregationVerifyCardProps {
  result: SearchVerifyResult
  systemName?: string
}

function AggregationVerifyCard({ result, systemName }: AggregationVerifyCardProps) {
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
          <span className="bg-warning-bg text-warning-text rounded-sm px-2 py-0.5 text-[11px] font-medium">
            {collectionLabel}
          </span>
          <span className="text-text-secondary text-[11px]">{displayedSystemName}</span>
          {periodLabel && <span className="text-text-disabled text-[11px]">{periodLabel}</span>}
          {severityClass && severityLabel && (
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', severityClass)}>
              {severityLabel}
            </span>
          )}
          <ScoreBadge score={result.score} />
        </div>
        {bodyText && <p className="text-text-secondary mt-1 line-clamp-3 text-xs">{bodyText}</p>}
        {llmTrend && (
          <div className="mt-2 flex items-start gap-1.5">
            <TrendingUp className="text-text-secondary mt-0.5 h-3 w-3 shrink-0" />
            <p className="text-text-secondary text-xs">{llmTrend}</p>
          </div>
        )}
        {llmPrediction && (
          <div className="mt-1 flex items-start gap-1.5">
            <Sparkles className="text-text-secondary mt-0.5 h-3 w-3 shrink-0" />
            <p className="text-text-secondary text-xs">{llmPrediction}</p>
          </div>
        )}
      </div>
    </NeuCard>
  )
}

// 로그 장애 / 메트릭 기준선 카드
interface IncidentCardProps {
  result: SearchVerifyResult
  systemName?: string
  originalQuery: string
}

function IncidentCard({ result, systemName, originalQuery }: IncidentCardProps) {
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
          <span className="bg-warning-bg text-warning-text rounded-sm px-2 py-0.5 text-[11px] font-medium">
            {collectionLabel}
          </span>
          <span className="text-text-secondary text-[11px]">{displayedSystemName}</span>
          {result.resolved_at && (
            <span
              className="text-text-disabled text-[11px]"
              title={formatKST(result.resolved_at, 'datetime')}
            >
              {formatKST(result.resolved_at, 'datetime')}
            </span>
          )}
          <ScoreBadge score={result.score} />
        </div>
        {result.content && (
          <p className="text-text-secondary mt-1 line-clamp-3 text-xs">{result.content}</p>
        )}
        {result.solution && <p className="text-text-primary mt-1 text-xs">{result.solution}</p>}
      </div>
      <div className="border-border flex items-center justify-end gap-1 border-t pt-2">
        <NeuButton
          variant="ghost"
          size="sm"
          onClick={handleFeedbackSearch}
          className="gap-1 px-2 text-xs"
        >
          해결책 검색
        </NeuButton>
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
}

function ResultCard({
  result,
  systemName,
  originalQuery,
  onNoteDeleted,
  onNoteEditRequest,
  onDocDeleted,
  onResync,
}: ResultCardProps) {
  const kind = getCardKind(result)

  if (kind === 'operator_note') {
    return (
      <OperatorNoteCard
        result={result}
        systemName={systemName}
        onNoteDeleted={onNoteDeleted}
        onNoteEditRequest={onNoteEditRequest}
      />
    )
  }
  if (kind === 'document_chunk') {
    return <DocumentChunkCard result={result} systemName={systemName} onDeleted={onDocDeleted} />
  }
  if (kind === 'jira_confluence') {
    return <JiraConfluenceCard result={result} onResync={onResync} />
  }
  // incident_metric: aggregation / hourly → AggregationVerifyCard, 그 외 → IncidentCard
  if (
    result.collection === 'aggregation_summaries' ||
    result.collection === 'metric_hourly_patterns'
  ) {
    return <AggregationVerifyCard result={result} systemName={systemName} />
  }
  return <IncidentCard result={result} systemName={systemName} originalQuery={originalQuery} />
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
      <p className="text-text-secondary text-xs font-medium">컬렉션 선택</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {ALL_COLLECTIONS.map((col) => {
          const checked = selected.includes(col)
          return (
            <label
              key={col}
              htmlFor={`collection-${col}`}
              className="flex cursor-pointer items-center gap-1.5 text-xs"
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

  const searchChatbot = useSearchVerifyChatbot()
  const searchCollections = useSearchVerifyCollections()

  const isPending = searchChatbot.isPending || searchCollections.isPending
  const isError = searchChatbot.isError || searchCollections.isError

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

  const handleResync = (_result: SearchVerifyResult) => {
    // TODO: 강제 재동기화 엔드포인트 연동 (현재 sync 트리거와 동일 흐름)
    alert('강제 재동기화가 요청되었습니다. 동기화 탭에서 진행 상황을 확인하세요.')
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
          <p className="text-text-secondary flex items-center gap-1 text-xs">
            <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
            Jira/Confluence 는 시스템 무관 전체 조회됩니다
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
                      'shadow-neu-flat absolute top-0.5 h-4 w-4 rounded-full transition-transform',
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
