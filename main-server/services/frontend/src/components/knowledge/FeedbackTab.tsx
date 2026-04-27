import { useState } from 'react'
import { Search, ChevronLeft, ChevronRight, ThumbsDown } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { EmptyState } from '@/components/common/EmptyState'
import { useKnowledgeFeedback } from '@/hooks/queries/useKnowledgeQueries'
import { useSystems } from '@/hooks/queries/useSystems'
import { formatKST, formatRelative } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { KnowledgeCorrection } from '@/types/knowledge'

const PAGE_SIZE = 20

const COLLECTION_LABEL: Record<string, string> = {
  operator_notes: '운영자 노트',
  log_incidents: '로그 분석',
  metric_baselines: '메트릭',
}

export function FeedbackTab() {
  const { data: systems = [] } = useSystems()
  const [filterSystemId, setFilterSystemId] = useState<string>('')
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<KnowledgeCorrection | null>(null)

  const params = {
    system_id: filterSystemId ? Number(filterSystemId) : undefined,
    q: appliedKeyword || undefined,
    limit: PAGE_SIZE,
    offset,
  }

  const { data, isLoading, isError, refetch } = useKnowledgeFeedback(params)
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasPrev = offset > 0
  const hasNext = offset + PAGE_SIZE < total

  const applySearch = () => {
    setAppliedKeyword(keyword.trim())
    setOffset(0)
  }

  return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-48">
          <NeuSelect
            value={filterSystemId}
            onChange={(e) => {
              setFilterSystemId(e.target.value)
              setOffset(0)
            }}
          >
            <option value="">전체 시스템</option>
            {systems.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.display_name}
              </option>
            ))}
          </NeuSelect>
        </div>
        <div className="min-w-[200px] flex-1">
          <NeuInput
            placeholder="질문 또는 교정 키워드"
            leftIcon={<Search className="h-4 w-4" />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applySearch()
              }
            }}
          />
        </div>
        <NeuButton size="sm" onClick={applySearch}>
          검색
        </NeuButton>
        {(appliedKeyword || filterSystemId) && (
          <NeuButton
            variant="ghost"
            size="sm"
            onClick={() => {
              setKeyword('')
              setAppliedKeyword('')
              setFilterSystemId('')
              setOffset(0)
            }}
          >
            초기화
          </NeuButton>
        )}
      </div>

      {isLoading && <LoadingSkeleton shape="table" count={8} />}
      {isError && <ErrorCard onRetry={refetch} />}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={<ThumbsDown className="text-text-secondary h-10 w-10" />}
          title="피드백 이력이 없습니다"
          description="사용자가 챗봇 답변에 👎를 눌러 교정을 제출하면 여기에 표시됩니다."
        />
      )}

      {!isLoading && !isError && items.length > 0 && (
        <NeuCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-border text-text-primary border-b text-left text-xs font-semibold tracking-wider uppercase">
                <tr>
                  <th className="px-3 py-2.5 whitespace-nowrap">ID</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">컬렉션</th>
                  <th className="px-3 py-2.5">질문</th>
                  <th className="px-3 py-2.5">교정 내용</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">등록일</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelected(item)}
                    className={cn(
                      'border-border text-text-primary cursor-pointer border-b transition-colors last:border-b-0',
                      selected?.id === item.id ? 'bg-accent-muted' : 'hover:bg-hover-subtle',
                    )}
                  >
                    <td className="text-text-secondary px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                      #{item.id}
                    </td>
                    <td className="text-text-secondary px-3 py-2.5 text-xs whitespace-nowrap">
                      {COLLECTION_LABEL[item.source_collection] ?? item.source_collection}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="block max-w-[200px] truncate text-xs">
                        {item.question ?? '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="block max-w-[240px] truncate text-xs">
                        {item.correct_answer}
                      </span>
                    </td>
                    <td className="text-text-secondary px-3 py-2.5 text-xs whitespace-nowrap">
                      {formatRelative(item.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </NeuCard>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-text-secondary text-sm">
            총 {total}건 · 페이지 {currentPage} / {totalPages}
          </span>
          <div className="flex gap-2">
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="h-4 w-4" />
              이전
            </NeuButton>
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={!hasNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              다음
              <ChevronRight className="h-4 w-4" />
            </NeuButton>
          </div>
        </div>
      )}

      {/* 상세 드로어 */}
      {selected && <FeedbackDetailDrawer item={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function FeedbackDetailDrawer({
  item,
  onClose,
}: {
  item: KnowledgeCorrection
  onClose: () => void
}) {
  return (
    <>
      <div className="bg-overlay fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <aside
        className={cn(
          'border-border bg-bg-base fixed top-0 right-0 z-50 flex h-full w-full max-w-[480px] flex-col border-l',
          'shadow-[-8px_0_32px_rgba(0,0,0,0.4)]',
        )}
      >
        <header className="border-border flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-text-primary text-sm font-semibold">피드백 상세</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm p-1 focus:ring-1 focus:outline-none"
          >
            <span className="text-lg leading-none">×</span>
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <DetailField label="ID">
            <span className="font-mono">#{item.id}</span>
          </DetailField>
          <DetailField label="컬렉션">
            {COLLECTION_LABEL[item.source_collection] ?? item.source_collection}
          </DetailField>
          <DetailField label="소스 포인트 ID">
            <span className="font-mono text-xs break-all">{item.source_point_id}</span>
          </DetailField>
          {item.question && <DetailField label="원본 질문">{item.question}</DetailField>}
          <DetailField label="교정된 답변">
            <div className="bg-bg-base shadow-neu-inset rounded-sm p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {item.correct_answer}
            </div>
          </DetailField>
          <DetailField label="등록일">{formatKST(item.created_at, 'datetime')}</DetailField>
        </div>
      </aside>
    </>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-text-secondary mb-1.5 text-xs font-semibold tracking-wider uppercase">
        {label}
      </h3>
      <p className="text-text-primary text-sm leading-relaxed">{children}</p>
    </section>
  )
}
