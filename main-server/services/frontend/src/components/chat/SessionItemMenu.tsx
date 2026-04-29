import { useState, useRef, useEffect, useCallback } from 'react'
import { MoreHorizontal, Pencil, Trash } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SessionItemMenuProps {
  onRename: () => void
  onDelete: () => void
  className?: string
}

export function SessionItemMenu({ onRename, onDelete, className }: SessionItemMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setOpen(false), [])

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  // ESC 닫기 + focus 복원
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, close])

  const handleRename = () => {
    close()
    onRename()
  }

  const handleDelete = () => {
    close()
    onDelete()
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        aria-label="세션 메뉴 열기"
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-sm',
          'text-text-secondary transition-colors duration-150',
          'hover:bg-surface hover:text-text-primary',
          'focus:ring-accent focus:ring-1 focus:outline-none',
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute top-full right-0 z-50 mt-1',
            'bg-surface border-border rounded-sm border p-1',
            'shadow-neu-flat',
            'w-36',
          )}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleRename}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
              'text-text-primary transition-colors duration-100',
              'hover:bg-bg-base hover:shadow-neu-pressed',
            )}
          >
            <Pencil className="text-text-secondary h-3.5 w-3.5 shrink-0" />
            이름 변경
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleDelete}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
              'text-critical transition-colors duration-100',
              'hover:bg-bg-base hover:shadow-neu-pressed',
            )}
          >
            <Trash className="h-3.5 w-3.5 shrink-0" />
            삭제
          </button>
        </div>
      )}
    </div>
  )
}
