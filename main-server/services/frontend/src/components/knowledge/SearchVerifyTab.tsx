import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Search,
  Info,
  Plus,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { EmptyState } from '@/components/common/EmptyState'
import { SystemMultiSelect } from '@/components/chat/SystemMultiSelect'
import { OperatorNoteFormModal } from './OperatorNoteFormModal'
import {
  SearchVerifyModeToggle,
  CollectionCheckboxGroup,
  RerankerToggle,
} from './SearchVerifyModeToggle'
import { ResultCard } from './SearchVerifyResultsList'
import { SearchResultDetailPanel } from './SearchVerifyDetailPanel'
import { useSystems } from '@/hooks/queries/useSystems'
import { useMyPrimarySystems } from '@/hooks/queries/useMyPrimarySystems'
import { useSearchVerifyLogic } from '@/hooks/useSearchVerifyLogic'
import { cn } from '@/lib/utils'
import { ALL_COLLECTIONS } from '@/types/knowledge-verify'
import type {
  SearchVerifyMode,
  RagCollection,
  SearchVerifyResult,
  CollectionGroup,
} from '@/types/knowledge-verify'
import type { OperatorNote } from '@/types/knowledge'

// ── 그룹 섹션 헤더 ────────────────────────────────────────────────────────────

interface GroupSectionProps {
  group: CollectionGroup
  systemName: (id?: number) => string | undefined
  originalQuery: string
  onNoteDeleted: () => void
  onNoteEditRequest: (note: OperatorNote) => void
  onDocDeleted: () => void
  onResync: (result: SearchVerifyResult) => void
  onDetailClick: (result: SearchVerifyResult) => void
  resyncingIds: Set<string>
}

function GroupSection({
  group,
  systemName,
  originalQuery,
  onNoteDeleted,
  onNoteEditRequest,
  onDocDeleted,
  onResync,
  onDetailClick,
  resyncingIds,
}: GroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const scoreKind: 'sim' | 'rrf' = group.reranked ? 'sim' : 'rrf'

  return (
    <div className="space-y-2">
      {/* 그룹 헤더 */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-sm px-2 py-1',
          'text-text-secondary hover:text-text-primary transition-colors',
          'focus:ring-accent focus:ring-1 focus:outline-none',
        )}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" />
        )}
        <span className="font-mono text-xs">{group.collection}</span>
        <span className="text-text-disabled text-xs">({group.results.length}건)</span>
        {group.reranked && (
          <span className="bg-accent-muted text-accent rounded-full px-2 py-0.5 text-[10px] font-medium">
            reranked
          </span>
        )}
      </button>

      {/* 결과 카드 목록 */}
      {!collapsed && (
        <div className="space-y-3 pl-2">
          {group.results.map((result, idx) => (
            <ResultCard
              key={`${result.collection}-${result.point_id ?? idx}`}
              result={result}
              systemName={systemName(result.system_id)}
              originalQuery={originalQuery}
              onNoteDeleted={onNoteDeleted}
              onNoteEditRequest={onNoteEditRequest}
              onDocDeleted={onDocDeleted}
              onResync={onResync}
              onDetailClick={result.point_id ? () => onDetailClick(result) : undefined}
              scoreKind={scoreKind}
              isResyncing={resyncingIds.has(result.point_id ?? '')}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 메인 탭 컴포넌트 ──────────────────────────────────────────────────────────

export function SearchVerifyTab() {
  const { data: systems = [] } = useSystems()
  const { data: primarySystems } = useMyPrimarySystems()

  // UI 상태
  const [mode, setMode] = useState<SearchVerifyMode>('chatbot')
  const [selectedSystems, setSelectedSystems] = useState<number[]>([])
  const [selectedCollections, setSelectedCollections] = useState<RagCollection[]>([
    ...ALL_COLLECTIONS,
  ])
  const [useReranker, setUseReranker] = useState(false)
  const [query, setQuery] = useState('')
  const [editNote, setEditNote] = useState<OperatorNote | null>(null)
  const [addNoteOpen, setAddNoteOpen] = useState(false)
  const [detailResult, setDetailResult] = useState<{
    result: SearchVerifyResult
    reranked: boolean
  } | null>(null)

  // 담당 시스템 자동 체크 — 최초 1회만
  const primarySystemsInitialized = useRef(false)
  useEffect(() => {
    if (!primarySystemsInitialized.current && primarySystems && primarySystems.length > 0) {
      primarySystemsInitialized.current = true
      setSelectedSystems(primarySystems.map((p) => p.system_id))
    }
  }, [primarySystems])

  // collections 모드에서만 reranker 활성화 가능
  const rerankerEnabled = mode === 'collections'

  useEffect(() => {
    if (!rerankerEnabled) setUseReranker(false)
  }, [rerankerEnabled])

  // 비즈니스 로직 훅
  const {
    groups,
    errors,
    hasSearched,
    isPending,
    isError,
    resyncingIds,
    handleSearch,
    handleResultsRefresh,
    handleResync,
  } = useSearchVerifyLogic({
    mode,
    query,
    selectedSystems,
    selectedCollections,
    useReranker,
  })

  const totalCount = groups.reduce((sum, g) => sum + g.results.length, 0)
  const allEmpty = groups.length === 0 || groups.every((g) => g.results.length === 0)

  const getSystemName = useCallback(
    (systemId?: number) => {
      if (!systemId) return undefined
      return systems.find((s) => s.id === systemId)?.display_name
    },
    [systems],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSearch()
    }
  }

  const handleDetailClick = useCallback((result: SearchVerifyResult, group: CollectionGroup) => {
    setDetailResult({ result, reranked: group.reranked })
  }, [])

  return (
    <div className="space-y-4">
      {/* 검색 설정 영역 */}
      <NeuCard className="space-y-4 p-4">
        <SearchVerifyModeToggle value={mode} onChange={setMode} />

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

        {mode === 'collections' && (
          <>
            <CollectionCheckboxGroup
              selected={selectedCollections}
              onChange={setSelectedCollections}
            />
            <RerankerToggle
              enabled={rerankerEnabled}
              active={useReranker}
              onToggle={() => rerankerEnabled && setUseReranker((v) => !v)}
            />
          </>
        )}

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

      {/* 부분 실패 오류 배지 */}
      {!isPending && !isError && hasSearched && errors.length > 0 && (
        <div className="space-y-1">
          {errors.map((err, idx) => (
            <div
              key={`${err.tool}-${err.collection}-${idx}`}
              className="bg-warning-bg text-warning-text flex items-center gap-2 rounded-sm px-3 py-2 text-sm"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="font-mono text-xs">{err.collection}</span>
              <span className="text-xs opacity-80">— {err.reason}</span>
            </div>
          ))}
        </div>
      )}

      {!isPending && !isError && hasSearched && allEmpty && errors.length === 0 && (
        <EmptyState
          icon={<Search className="text-text-secondary h-10 w-10" />}
          title="검색 결과가 없습니다"
          description="다른 키워드나 컬렉션으로 다시 시도해보세요."
        />
      )}

      {!isPending && !isError && hasSearched && !allEmpty && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-text-secondary text-sm">
              검색 결과 <span className="text-text-primary font-semibold">{totalCount}</span>건
              {groups.length > 1 && (
                <span className="ml-1 opacity-60">({groups.length}개 컬렉션)</span>
              )}
            </p>
          </div>

          <div className="space-y-5">
            {groups
              .filter((g) => g.results.length > 0)
              .map((group) => (
                <GroupSection
                  key={group.collection}
                  group={group}
                  systemName={getSystemName}
                  originalQuery={query}
                  onNoteDeleted={handleResultsRefresh}
                  onNoteEditRequest={setEditNote}
                  onDocDeleted={handleResultsRefresh}
                  onResync={handleResync}
                  onDetailClick={(result) => handleDetailClick(result, group)}
                  resyncingIds={resyncingIds}
                />
              ))}
          </div>
        </>
      )}

      {hasSearched && !isPending && !isError && (
        <div className="border-border mt-2 border-t pt-4">
          <NeuButton
            variant="ghost"
            onClick={() => setAddNoteOpen(true)}
            className="text-accent gap-2 text-sm"
          >
            <Plus className="h-4 w-4" />이 검색어로 운영자 노트 추가
          </NeuButton>
        </div>
      )}

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

      {detailResult && (
        <SearchResultDetailPanel
          result={detailResult.result}
          onClose={() => setDetailResult(null)}
          scoreKind={detailResult.reranked ? 'sim' : 'rrf'}
        />
      )}

      {!isPending && !isError && !hasSearched && (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <AlertTriangle className="text-text-disabled h-10 w-10" />
          <p className="text-text-secondary text-sm">질의를 입력하고 검색 버튼을 누르세요</p>
        </div>
      )}
    </div>
  )
}
