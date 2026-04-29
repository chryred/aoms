import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { System } from '@/types/system'

interface SystemMultiSelectProps {
  value: number[]
  onChange: (ids: number[]) => void
  systems: System[]
  label?: string
  placeholder?: string
}

/**
 * 시스템 멀티 셀렉트 드롭다운 (체크박스 방식)
 *
 * - 빈 배열(value=[]) → placeholder 표시 ("시스템 선택")
 * - 1개 선택 → display_name
 * - 2개 이상 → "{first} 외 N개"
 * - "전체 선택" → 모든 시스템 ID를 배열에 채움 (NeuMultiSelect의 빈배열=전체와 다름)
 */
export function SystemMultiSelect({
  value,
  onChange,
  systems,
  label,
  placeholder = '시스템 선택',
}: SystemMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)

  const isAllSelected = systems.length > 0 && value.length === systems.length

  // Close on outside click
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setIsOpen(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, handleClickOutside])

  // Reset focused index when closed; auto-focus listbox when opened (키보드 네비 활성화)
  useEffect(() => {
    if (!isOpen) {
      setFocusedIndex(-1)
    } else {
      // 트리거 ArrowDown / 클릭 후 listbox에 focus를 주어 onKeyDown(ArrowUp/Down/Enter/Escape)이 동작하도록
      setTimeout(() => listboxRef.current?.focus(), 0)
    }
  }, [isOpen])

  const toggleAll = () => {
    if (isAllSelected) {
      onChange([])
    } else {
      onChange(systems.map((s) => s.id))
    }
  }

  const toggleItem = (id: number) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  // Trigger button display label
  const triggerLabel = () => {
    if (value.length === 0) return null
    if (value.length === 1) {
      const sys = systems.find((s) => s.id === value[0])
      return sys?.display_name ?? '1개 선택'
    }
    const first = systems.find((s) => s.id === value[0])
    return `${first?.display_name ?? ''} 외 ${value.length - 1}개`
  }

  const label_ = triggerLabel()

  // Keyboard navigation — items: index 0 = "전체 선택", 1..n = systems
  const totalItems = systems.length + 1 // 전체 + each system
  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setIsOpen((v) => !v)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIsOpen(true)
      setFocusedIndex(0)
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const handleListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((i) => Math.min(i + 1, totalItems - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((i) => {
        if (i <= 0) {
          setIsOpen(false)
          triggerRef.current?.focus()
          return -1
        }
        return i - 1
      })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (focusedIndex === 0) {
        toggleAll()
      } else if (focusedIndex > 0) {
        const sys = systems[focusedIndex - 1]
        if (sys) toggleItem(sys.id)
      }
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="text-text-secondary mb-1.5 block text-[0.8125rem] font-medium">
          {label}
        </label>
      )}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          'bg-bg-base w-full rounded-sm',
          'border-border border',
          'shadow-neu-inset',
          'flex min-h-11 items-center justify-between gap-2 px-3 py-2 text-sm',
          'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:ring-offset-2 focus:outline-none',
          label_ == null ? 'text-text-secondary' : 'text-text-primary',
        )}
      >
        <span className="truncate">{label_ ?? placeholder}</span>
        <ChevronDown
          className={cn(
            'text-text-secondary h-4 w-4 flex-shrink-0 transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen && (
        <div
          ref={listboxRef}
          role="listbox"
          aria-multiselectable="true"
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
          className={cn(
            'bg-surface absolute z-50 mt-1 w-full',
            'border-border rounded-sm border',
            'shadow-neu-flat',
            'max-h-56 overflow-y-auto',
          )}
        >
          {/* 전체 선택 / 전체 해제 */}
          <button
            type="button"
            role="option"
            aria-selected={isAllSelected}
            onClick={toggleAll}
            onFocus={() => setFocusedIndex(0)}
            className={cn(
              'flex w-full items-center gap-2.5 px-3 py-2 text-sm',
              'hover:bg-bg-base transition-colors',
              'text-text-primary font-medium',
              focusedIndex === 0 && 'bg-bg-base',
            )}
          >
            <span
              className={cn(
                'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border',
                isAllSelected ? 'border-accent bg-accent' : 'border-border bg-bg-base',
              )}
            >
              {isAllSelected && <Check className="text-accent-contrast h-3 w-3" />}
            </span>
            {isAllSelected ? '전체 해제' : '전체 선택'}
          </button>

          <div className="border-border border-t" />

          {systems.map((sys, idx) => {
            const checked = value.includes(sys.id)
            const itemFocused = focusedIndex === idx + 1
            return (
              <button
                key={sys.id}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggleItem(sys.id)}
                onFocus={() => setFocusedIndex(idx + 1)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-sm',
                  'hover:bg-bg-base transition-colors',
                  'text-text-primary',
                  itemFocused && 'bg-bg-base',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border',
                    checked ? 'border-accent bg-accent' : 'border-border bg-bg-base',
                  )}
                >
                  {checked && <Check className="text-accent-contrast h-3 w-3" />}
                </span>
                {sys.display_name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
