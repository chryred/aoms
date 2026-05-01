import { useRef, useState, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { ALL_COLLECTIONS, COLLECTION_LABELS } from '@/types/knowledge-verify'
import type { SearchVerifyMode, RagCollection } from '@/types/knowledge-verify'

// 검색 모드 탭 토글 (PeriodToggle 슬라이딩 인디케이터 패턴)
interface ModeToggleProps {
  value: SearchVerifyMode
  onChange: (mode: SearchVerifyMode) => void
}

export function SearchVerifyModeToggle({ value, onChange }: ModeToggleProps) {
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

// 컬렉션 체크박스 그룹 (collections 모드 전용)
interface CollectionCheckboxGroupProps {
  selected: RagCollection[]
  onChange: (collections: RagCollection[]) => void
}

export function CollectionCheckboxGroup({ selected, onChange }: CollectionCheckboxGroupProps) {
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

// Reranker 토글 (collections 모드 + knowledge_* 컬렉션 선택 시 활성)
interface RerankerToggleProps {
  enabled: boolean
  active: boolean
  onToggle: () => void
}

export function RerankerToggle({ enabled, active, onToggle }: RerankerToggleProps) {
  return (
    <div className="flex items-center gap-3">
      <label
        className={cn(
          'flex cursor-pointer items-center gap-2 text-sm',
          !enabled && 'cursor-not-allowed opacity-40',
        )}
      >
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label="Reranker 적용"
          disabled={!enabled}
          onClick={onToggle}
          className={cn(
            'focus:ring-accent relative h-5 w-9 rounded-full border transition-colors focus:ring-1 focus:outline-none',
            active && enabled ? 'border-accent bg-accent' : 'border-border bg-bg-base',
          )}
        >
          <span
            className={cn(
              'shadow-neu-flat absolute top-0.5 h-4 w-4 rounded-full transition-transform duration-150',
              active && enabled ? 'bg-accent-contrast left-4' : 'bg-text-disabled left-0.5',
            )}
          />
        </button>
        <span className={cn('text-sm', enabled ? 'text-text-primary' : 'text-text-disabled')}>
          Reranker 적용
        </span>
      </label>
      {!enabled && (
        <span className="text-text-disabled text-xs">(knowledge_* 컬렉션 선택 시 활성화)</span>
      )}
    </div>
  )
}
