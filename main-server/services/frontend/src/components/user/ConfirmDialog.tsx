import { useEffect, useRef } from 'react'
import { NeuButton } from '@/components/neumorphic/NeuButton'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  confirmVariant?: 'default' | 'destructive'
  onConfirm: () => void
  isPending?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = 'default',
  onConfirm,
  isPending,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Focus trap + ESC close
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    getFocusable()[0]?.focus()

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) {
        onOpenChange(false)
        return
      }
      if (e.key !== 'Tab') return
      const focusables = getFocusable()
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, isPending, onOpenChange])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      {/* 오버레이 */}
      <div
        className="bg-overlay absolute inset-0"
        onClick={() => !isPending && onOpenChange(false)}
        aria-hidden="true"
      />

      {/* 다이얼로그 */}
      <div
        ref={dialogRef}
        className="border-border bg-bg-base shadow-neu-flat relative z-10 mx-4 w-full max-w-sm rounded-sm border p-6"
      >
        <h2 id="confirm-dialog-title" className="text-text-primary mb-2 text-base font-semibold">
          {title}
        </h2>
        <p className="text-text-secondary mb-6 text-sm">{description}</p>

        <div className="flex justify-end gap-3">
          <NeuButton
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            취소
          </NeuButton>
          <NeuButton
            variant={confirmVariant === 'destructive' ? 'danger' : 'primary'}
            size="sm"
            disabled={isPending}
            loading={isPending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </NeuButton>
        </div>
      </div>
    </div>
  )
}
