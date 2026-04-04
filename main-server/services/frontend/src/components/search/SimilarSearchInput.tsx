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
    [onSearch]
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
              'px-4 py-2 rounded-xl text-sm font-medium transition-all',
              'focus:outline-none focus:ring-2 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127]',
              collection === opt.value
                ? 'bg-[#00D4FF] text-[#1E2127] font-semibold shadow-[2px_2px_5px_#111317,-2px_-2px_5px_#2B2F37]'
                : 'bg-[#1E2127] text-[#8B97AD] shadow-[2px_2px_5px_#111317,-2px_-2px_5px_#2B2F37] hover:text-[#E2E8F2]'
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
          'w-full rounded-xl bg-[#1E2127] px-4 py-3 text-sm text-[#E2E8F2]',
          'shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37]',
          'border border-[#2B2F37]',
          'placeholder:text-[#5A6478] resize-none whitespace-pre-wrap',
          'focus:outline-none focus:ring-2 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127]'
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
        <div className="flex justify-between items-center">
          <label
            htmlFor="threshold-slider"
            id={thresholdId.current}
            className="text-sm font-medium text-[#E2E8F2]"
          >
            유사도 기준값
          </label>
          <span className="text-sm font-semibold text-[#00D4FF]">
            {(threshold * 100).toFixed(0)}%
          </span>
        </div>
        <input
          id="threshold-slider"
          type="range"
          min={0.5}
          max={1.0}
          step={0.05}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full accent-[#00D4FF] focus:outline-none focus:ring-2 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127]"
          aria-label="유사도 기준값"
          aria-valuemin={0.5}
          aria-valuemax={1.0}
          aria-valuenow={threshold}
        />
        <div className="flex justify-between text-xs text-[#5A6478]">
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
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        {isPending ? '검색 중...' : '검색'}
      </NeuButton>
    </NeuCard>
  )
}
