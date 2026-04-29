import { useState, useEffect, useRef } from 'react'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { Modal } from '@/components/common/Modal'

interface SessionRenameModalProps {
  open: boolean
  initialTitle: string
  onClose: () => void
  onSubmit: (title: string) => Promise<void> | void
  isPending?: boolean
}

export function SessionRenameModal({
  open,
  initialTitle,
  onClose,
  onSubmit,
  isPending = false,
}: SessionRenameModalProps) {
  const [title, setTitle] = useState(initialTitle)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTitle(initialTitle)
    }
  }, [open, initialTitle])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const trimmed = title.trim()
  const canSubmit = trimmed.length > 0 && !isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    await onSubmit(trimmed)
  }

  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="rename-modal-title">
      <h2 id="rename-modal-title" className="text-text-primary mb-4 text-base font-semibold">
        대화 이름 변경
      </h2>

      <form onSubmit={handleSubmit}>
        <NeuInput
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="대화 제목을 입력하세요"
          aria-label="대화 제목"
        />

        <div className="mt-4 flex justify-end gap-2">
          <NeuButton type="button" variant="secondary" size="sm" onClick={onClose}>
            취소
          </NeuButton>
          <NeuButton
            type="submit"
            variant="primary"
            size="sm"
            disabled={!canSubmit}
            loading={isPending}
          >
            저장
          </NeuButton>
        </div>
      </form>
    </Modal>
  )
}
