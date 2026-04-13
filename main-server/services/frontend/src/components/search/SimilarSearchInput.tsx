import { useState, useEffect, useMemo, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { cn } from '@/lib/utils'

interface SimilarSearchInputProps {
  defaultQuery?: string
  defaultThreshold?: number
  defaultCollection?: string
  onSearch: (params: { query: string; threshold: number; collection: string }) => void
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
  defaultThreshold = 0.75,
  defaultCollection = 'metric_hourly_patterns',
  onSearch,
  isPending,
}: SimilarSearchInputProps) {
  const [query, setQuery] = useState(defaultQuery)
  const [threshold, setThreshold] = useState(defaultThreshold)
  const [collection, setCollection] = useState(defaultCollection)
  const thresholdId = useRef(`threshold-desc-${Math.random().toString(36).slice(2)}`)

  useEffect(() => setQuery(defaultQuery), [defaultQuery])
  useEffect(() => setThreshold(defaultThreshold), [defaultThreshold])
  useEffect(() => setCollection(defaultCollection), [defaultCollection])

  const handleSearch = useMemo(
    () =>
      debounce((params: { query: string; threshold: number; collection: string }) => {
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
        placeholder="예: CPU 사용률이 80%를 초과하며 응답시간이 급증한 패턴"
        aria-label="검색 쿼리 입력"
        aria-describedby={thresholdId.current}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            handleSearch({ query, threshold, collection })
          }
        }}
      />

      {/* Threshold slider */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label
            htmlFor="threshold-slider"
            id={thresholdId.current}
            className="text-text-primary text-sm font-medium"
          >
            유사도 기준값
          </label>
          <span className="text-accent text-sm font-semibold">{(threshold * 100).toFixed(0)}%</span>
        </div>
        <input
          id="threshold-slider"
          type="range"
          min={0.5}
          max={1.0}
          step={0.05}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="focus:ring-accent focus:ring-offset-bg-base w-full accent-[#00D4FF] focus:ring-1 focus:ring-offset-2 focus:outline-none"
          aria-label="유사도 기준값"
          aria-valuemin={0.5}
          aria-valuemax={1.0}
          aria-valuenow={threshold}
        />
        <div className="text-text-disabled flex justify-between text-xs">
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Search button */}
      <NeuButton
        type="button"
        disabled={isPending || !query.trim()}
        onClick={() => handleSearch({ query, threshold, collection })}
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
