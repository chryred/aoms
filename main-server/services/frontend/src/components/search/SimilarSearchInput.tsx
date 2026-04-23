import { useState, useEffect, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { cn } from '@/lib/utils'

interface SimilarSearchInputProps {
  defaultQuery?: string
  defaultCollection?: string
  onSearch: (params: { query: string; collection: string }) => void
  isPending: boolean
}

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout>
  const debounced = (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
  debounced.cancel = () => clearTimeout(timer)
  return debounced
}

export function SimilarSearchInput({
  defaultQuery = '',
  defaultCollection = 'metric_hourly_patterns',
  onSearch,
  isPending,
}: SimilarSearchInputProps) {
  const [query, setQuery] = useState(defaultQuery)
  const [collection, setCollection] = useState(defaultCollection)

  useEffect(() => setQuery(defaultQuery), [defaultQuery])
  useEffect(() => setCollection(defaultCollection), [defaultCollection])

  const handleSearch = useMemo(
    () =>
      debounce((params: { query: string; collection: string }) => {
        if (!params.query.trim()) return
        onSearch(params)
      }, 500),
    [onSearch],
  )

  useEffect(() => () => handleSearch.cancel(), [handleSearch])

  return (
    <NeuCard className="flex flex-col gap-4">
      {/* Collection toggle */}
      <div className="flex gap-2" role="group" aria-label="컬렉션 선택">
        {[
          { value: 'metric_hourly_patterns', label: '시간별 패턴' },
          { value: 'aggregation_summaries', label: '기간별 요약' },
        ].map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setCollection(opt.value)}
            className={cn(
              'rounded-sm px-4 py-2 text-sm font-medium transition-all',
              'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:ring-offset-2 focus:outline-none',
              collection === opt.value
                ? 'bg-accent text-accent-contrast shadow-neu-flat font-semibold'
                : 'bg-bg-base text-text-secondary shadow-neu-flat hover:text-text-primary',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Query textarea */}
      <textarea
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={4}
        className={cn(
          'bg-bg-base text-text-primary w-full rounded-sm px-4 py-3 text-sm',
          'shadow-neu-inset',
          'border-border border',
          'placeholder:text-text-disabled resize-none whitespace-pre-wrap',
          'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:ring-offset-2 focus:outline-none',
        )}
        placeholder="예: ERROR 로그가 급증하며 시스템 장애가 예상되는 패턴 (Enter=검색, Shift+Enter=줄바꿈)"
        aria-label="검색 쿼리 입력"
        onKeyDown={(e) => {
          // 한글 IME 조합 중 Enter는 무시 (조합 확정용)
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            handleSearch({ query, collection })
          }
          // Shift+Enter 는 기본 줄바꿈 동작 유지 (preventDefault 없음)
        }}
      />

      {/* Search button */}
      <NeuButton
        type="button"
        disabled={isPending || !query.trim()}
        onClick={() => handleSearch({ query, collection })}
        aria-busy={isPending}
        aria-label={isPending ? '검색 중' : '검색'}
        className="self-end"
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {isPending ? '검색 중...' : '검색'}
      </NeuButton>
    </NeuCard>
  )
}
