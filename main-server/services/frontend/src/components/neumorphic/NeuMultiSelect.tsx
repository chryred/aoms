import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MultiSelectOption {
  value: string | number
  label: string
}

interface NeuMultiSelectProps {
  label?: string
  options: MultiSelectOption[]
  selected: (string | number)[]
  onChange: (selected: (string | number)[]) => void
  allLabel?: string
  placeholder?: string
  className?: string
}

export function NeuMultiSelect({
  label,
  options,
  selected,
  onChange,
  allLabel = '전체',
  placeholder = '시스템 선택...',
  className,
}: NeuMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const isAllSelected = selected.length === 0

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

  const toggleAll = () => {
    onChange([])
  }

  const toggleOption = (value: string | number) => {
    if (isAllSelected) {
      onChange([value])
      return
    }
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]
    if (next.length === 0 || next.length === options.length) {
      onChange([])
    } else {
      onChange(next)
    }
  }

  const triggerLabel = isAllSelected
    ? allLabel
    : selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label ?? '1개 선택')
      : `${selected.length}개 선택`

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {label && (
        <label className="text-text-secondary mb-1.5 block text-[0.8125rem] font-medium">
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          'bg-bg-base w-full rounded-sm',
          'border-border border',
          'shadow-neu-inset',
          'flex items-center justify-between gap-2 px-3 py-2 text-sm',
          'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:ring-offset-2 focus:outline-none',
          isAllSelected ? 'text-text-secondary' : 'text-text-primary',
        )}
      >
        <span className="truncate">{isAllSelected ? placeholder : triggerLabel}</span>
        <ChevronDown
          className={cn(
            'text-text-secondary h-4 w-4 flex-shrink-0 transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen && (
        <div
          className={cn(
            'bg-surface absolute z-50 mt-1 w-full',
            'border-border rounded-sm border',
            'shadow-neu-flat',
            'max-h-56 overflow-y-auto',
          )}
        >
          <button
            type="button"
            onClick={toggleAll}
            className={cn(
              'flex w-full items-center gap-2.5 px-3 py-2 text-sm',
              'hover:bg-bg-base transition-colors',
              'text-text-primary font-medium',
            )}
          >
            <span
              className={cn(
                'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[2px] border',
                isAllSelected ? 'border-accent bg-accent' : 'border-border bg-bg-base',
              )}
            >
              {isAllSelected && <Check className="text-accent-contrast h-3 w-3" />}
            </span>
            {allLabel}
          </button>

          <div className="border-border border-t" />

          {options.map((opt) => {
            const checked = isAllSelected || selected.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleOption(opt.value)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-sm',
                  'hover:bg-bg-base transition-colors',
                  'text-text-primary',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[2px] border',
                    checked ? 'border-accent bg-accent' : 'border-border bg-bg-base',
                  )}
                >
                  {checked && <Check className="text-accent-contrast h-3 w-3" />}
                </span>
                {opt.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
