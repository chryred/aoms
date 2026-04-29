import { useEffect, useRef } from 'react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { Modal } from '@/components/common/Modal'

interface SessionDeleteConfirmModalProps {
  open: boolean
  sessionTitle: string
  onClose: () => void
  onConfirm: () => Promise<void> | void
  isPending?: boolean
}

export function SessionDeleteConfirmModal({
  open,
  sessionTitle,
  onClose,
  onConfirm,
  isPending = false,
}: SessionDeleteConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => cancelRef.current?.focus(), 50)
    }
  }, [open])

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    await onConfirm()
  }

  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="delete-modal-title">
      <h2 id="delete-modal-title" className="text-text-primary mb-3 text-base font-semibold">
        대화 삭제
      </h2>

      <p className="text-text-secondary mb-5 text-sm leading-relaxed">
        <span className="text-text-primary font-medium">&ldquo;{sessionTitle}&rdquo;</span> 대화를
        삭제할까요? 삭제된 대화는 목록에서 제외됩니다.
      </p>

      <form onSubmit={handleConfirm}>
        <div className="flex justify-end gap-2">
          <NeuButton ref={cancelRef} type="button" variant="secondary" size="sm" onClick={onClose}>
            취소
          </NeuButton>
          <NeuButton
            type="submit"
            variant="danger"
            size="sm"
            disabled={isPending}
            loading={isPending}
          >
            삭제
          </NeuButton>
        </div>
      </form>
    </Modal>
  )
}
