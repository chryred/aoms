import { useEffect } from 'react'
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
  // ESC로 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onOpenChange(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
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
        className="absolute inset-0 bg-black/40"
        onClick={() => !isPending && onOpenChange(false)}
      />

      {/* 다이얼로그 */}
      <div className="relative z-10 w-full max-w-sm mx-4 bg-[#E8EBF0] rounded-2xl shadow-[8px_8px_16px_#C8CBD4,-8px_-8px_16px_#FFFFFF] p-6">
        <h2
          id="confirm-dialog-title"
          className="text-base font-semibold text-[#1A1F2E] mb-2"
        >
          {title}
        </h2>
        <p className="text-sm text-[#4A5568] mb-6">{description}</p>

        <div className="flex gap-3 justify-end">
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
