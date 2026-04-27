import { useState } from 'react'
import { TrendingUp, MessageCircle, Plus } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { EmptyState } from '@/components/common/EmptyState'
import { useFrequentQuestions } from '@/hooks/queries/useKnowledgeQueries'
import { formatRelative } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { FrequentQuestion } from '@/types/knowledge'

const DAY_OPTIONS = [7, 14, 30, 60, 90]
const THRESHOLD_OPTIONS = [
  { value: 2, label: '2회 이상' },
  { value: 3, label: '3회 이상' },
  { value: 5, label: '5회 이상' },
]

interface FrequentQuestionsTabProps {
  onAddNote: (question?: string) => void
}

export function FrequentQuestionsTab({ onAddNote }: FrequentQuestionsTabProps) {
  const [days, setDays] = useState(30)
  const [threshold, setThreshold] = useState(3)

  const { data, isLoading, isError, refetch } = useFrequentQuestions(days, threshold)

  return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="bg-bg-base shadow-neu-pressed inline-flex gap-1 rounded-sm p-1"
          role="group"
          aria-label="기간 필터"
        >
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={cn(
                'rounded-sm px-3 py-1 text-xs font-medium',
                'transition-[color,background-color] duration-150',
                'focus:ring-accent focus:ring-1 focus:outline-none',
                days === d
                  ? 'bg-accent text-accent-contrast shadow-neu-flat font-semibold'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {d}일
            </button>
          ))}
        </div>

        <div
          className="bg-bg-base shadow-neu-pressed inline-flex gap-1 rounded-sm p-1"
          role="group"
          aria-label="최소 발생 횟수 필터"
        >
          {THRESHOLD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={threshold === opt.value}
              onClick={() => setThreshold(opt.value)}
              className={cn(
                'rounded-sm px-3 py-1 text-xs font-medium',
                'transition-[color,background-color] duration-150',
                'focus:ring-accent focus:ring-1 focus:outline-none',
                threshold === opt.value
                  ? 'bg-accent text-accent-contrast shadow-neu-flat font-semibold'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <LoadingSkeleton shape="card" count={5} />}
      {isError && <ErrorCard onRetry={refetch} />}
      {!isLoading && !isError && (!data || data.length === 0) && (
        <EmptyState
          icon={<TrendingUp className="text-text-secondary h-10 w-10" />}
          title="자주 묻는 질문이 없습니다"
          description={`최근 ${days}일간 ${threshold}회 이상 발생한 유사 질문이 없습니다.`}
        />
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <div className="space-y-3">
          {data.map((q, idx) => (
            <FrequentQuestionCard key={idx} question={q} onAddNote={onAddNote} />
          ))}
        </div>
      )}
    </div>
  )
}

function FrequentQuestionCard({
  question,
  onAddNote,
}: {
  question: FrequentQuestion
  onAddNote: (q?: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasSimilar = question.similar_queries.length > 0

  return (
    <NeuCard className="p-4">
      <div className="flex items-start gap-3">
        {/* 아이콘 */}
        <MessageCircle className="text-accent mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />

        <div className="min-w-0 flex-1">
          {/* 대표 질문 */}
          <p className="text-text-primary text-sm font-medium">{question.representative_query}</p>

          {/* 메타 정보 */}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-accent bg-accent-muted inline-flex items-center rounded-full px-2 py-0.5 text-xs">
              {question.occurrence_count}회
            </span>
            {question.category && (
              <span className="text-text-secondary bg-hover-subtle inline-flex items-center rounded-full px-2 py-0.5 text-xs">
                {question.category}
              </span>
            )}
            <span className="text-text-secondary text-xs">
              마지막 질문: {formatRelative(question.last_asked)}
            </span>
          </div>

          {/* 유사 질문 펼치기 */}
          {hasSimilar && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-text-secondary hover:text-text-primary text-xs underline-offset-2 hover:underline focus:outline-none"
              >
                유사 질문 {question.similar_queries.length}개 {expanded ? '접기' : '보기'}
              </button>
              {expanded && (
                <ul className="mt-2 space-y-1">
                  {question.similar_queries.map((q, i) => (
                    <li
                      key={i}
                      className="text-text-secondary bg-hover-subtle rounded-sm px-2 py-1 text-xs"
                    >
                      {q}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* 노트 추가 버튼 */}
        <NeuButton
          variant="ghost"
          size="sm"
          onClick={() => onAddNote(question.representative_query)}
          className="shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          노트 추가
        </NeuButton>
      </div>
    </NeuCard>
  )
}
