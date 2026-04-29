import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  ariaLabelledBy?: string
  className?: string
  children: ReactNode
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 공용 모달 셸. ESC 닫기 + Tab focus trap + overlay 클릭 닫기 내장.
 * - 카드 셸: bg-surface, shadow-neu-flat, rounded-sm, w-[420px] max-w-[calc(100vw-2rem)]
 * - 자식이 첫 focusable 요소에 자동 focus를 줄 책임 (예: input ref / 안전 디폴트 버튼)
 */
export function Modal({ open, onClose, ariaLabelledBy, className, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const focusables = ref.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="bg-overlay fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        ref={ref}
        className={cn(
          'bg-surface border-border rounded-sm border p-6',
          'shadow-neu-flat',
          'w-[420px] max-w-[calc(100vw-2rem)]',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
      >
        {children}
      </div>
    </div>
  )
}
