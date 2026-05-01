import { useState } from 'react'
import {
  Search,
  Globe,
  ExternalLink,
  RefreshCw,
  Pencil,
  Trash2,
  FileText,
  TrendingUp,
  Sparkles,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { useDeleteOperatorNote } from '@/hooks/mutations/useKnowledgeMutations'
import { useDeleteDocument } from '@/hooks/mutations/useDeleteDocument'
import { cn, formatKST, formatRelative, formatPeriodLabel } from '@/lib/utils'
import { ROUTES } from '@/constants/routes'
import { getCardKind } from '@/types/knowledge-verify'
import { ScoreBadge, PointIdBadge, DeleteConfirmInline } from './SearchVerifyDetailPanel'
import type { SearchVerifyResult } from '@/types/knowledge-verify'
import type { OperatorNote } from '@/types/knowledge'
import type { ReportType } from '@/types/report'

// ── 운영자 노트 카드 ──────────────────────────────────────────────────────────

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

// ── 문서 청크 카드 ────────────────────────────────────────────────────────────

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

// ── Jira / Confluence 카드 ────────────────────────────────────────────────────

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

// ── 집계 요약 / 시간별 패턴 카드 ─────────────────────────────────────────────

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

// ── 로그 장애 / 메트릭 기준선 카드 ───────────────────────────────────────────

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

// ── ResultCard 분기 디스패처 ──────────────────────────────────────────────────

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

export function ResultCard({
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
