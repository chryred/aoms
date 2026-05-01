import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, Info, Plus, AlertTriangle } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { EmptyState } from '@/components/common/EmptyState'
import { SystemMultiSelect } from '@/components/chat/SystemMultiSelect'
import { OperatorNoteFormModal } from './OperatorNoteFormModal'
import { SearchVerifyModeToggle, CollectionCheckboxGroup, RerankerToggle } from './SearchVerifyModeToggle'
import { ResultCard } from './SearchVerifyResultsList'
import { SearchResultDetailPanel } from './SearchVerifyDetailPanel'
import { useSystems } from '@/hooks/queries/useSystems'
import { useMyPrimarySystems } from '@/hooks/queries/useMyPrimarySystems'
import { useSearchVerifyLogic } from '@/hooks/useSearchVerifyLogic'
import { cn } from '@/lib/utils'
import { ALL_COLLECTIONS, KNOWLEDGE_COLLECTIONS } from '@/types/knowledge-verify'
import type { SearchVerifyMode, RagCollection, SearchVerifyResult } from '@/types/knowledge-verify'
import type { OperatorNote } from '@/types/knowledge'

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
  const [detailResult, setDetailResult] = useState<SearchVerifyResult | null>(null)

  // 담당 시스템 자동 체크 — 최초 1회만
  const primarySystemsInitialized = useRef(false)
  useEffect(() => {
    if (!primarySystemsInitialized.current && primarySystems && primarySystems.length > 0) {
      primarySystemsInitialized.current = true
      setSelectedSystems(primarySystems.map((p) => p.system_id))
    }
  }, [primarySystems])

  const rerankerEnabled =
    mode === 'collections' && selectedCollections.some((c) => KNOWLEDGE_COLLECTIONS.includes(c))

  useEffect(() => {
    if (!rerankerEnabled) setUseReranker(false)
  }, [rerankerEnabled])

  // 비즈니스 로직 훅
  const {
    results,
    hasSearched,
    isPending,
    isError,
    scoreKind,
    resyncingIds,
    handleSearch,
    handleResultsRefresh,
    handleResync,
  } = useSearchVerifyLogic({
    mode,
    query,
    selectedSystems,
    selectedCollections,
    rerankerEnabled,
    useReranker,
  })

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
          result={detailResult}
          onClose={() => setDetailResult(null)}
          scoreKind={scoreKind}
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
