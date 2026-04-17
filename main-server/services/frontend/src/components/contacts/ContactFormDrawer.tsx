import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { ContactForm } from '@/components/contacts/ContactForm'
import { useContact } from '@/hooks/queries/useContacts'
import { useCreateContact } from '@/hooks/mutations/useCreateContact'
import { useUpdateContact } from '@/hooks/mutations/useUpdateContact'
import { cn } from '@/lib/utils'
import type { Contact, ContactCreate } from '@/types/contact'

interface ContactFormDrawerProps {
  open: boolean
  onClose: () => void
  editTarget?: Contact | null
}

export function ContactFormDrawer({ open, onClose, editTarget }: ContactFormDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)
  // 닫힘 애니메이션 중에도 컨텐츠 유지
  const lastEditRef = useRef<Contact | null>(null)
  if (open) lastEditRef.current = editTarget ?? null
  const displayEdit = open ? (editTarget ?? null) : lastEditRef.current
  const isEdit = Boolean(displayEdit)
  const contactId = displayEdit?.id ?? 0

  // 수정 시 최신 단건 조회 (list 응답이 오래된 경우 대비)
  const { data: fetched } = useContact(contactId)
  const existing = fetched ?? displayEdit ?? undefined

  const createMutation = useCreateContact()
  const updateMutation = useUpdateContact(contactId)
  const isPending = createMutation.isPending || updateMutation.isPending

  // Focus trap + ESC close
  useEffect(() => {
    if (!open) return
    const drawer = drawerRef.current
    if (!drawer) return
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE))
    getFocusable()[0]?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
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
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const handleSubmit = (data: ContactCreate) => {
    if (isEdit) {
      updateMutation.mutate(data, { onSuccess: onClose })
    } else {
      createMutation.mutate(data, { onSuccess: onClose })
    }
  }

  return (
    <>
      <div
        className={cn(
          'bg-overlay fixed inset-0 z-40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label={isEdit ? '담당자 수정' : '담당자 등록'}
        className={cn(
          'border-border bg-bg-base fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[480px] flex-col border-l shadow-[-8px_0_32px_rgba(0,0,0,0.4)] transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-text-primary text-lg font-semibold">
            {isEdit ? `담당자 수정 — ${existing?.name ?? ''}` : '담당자 등록'}
          </h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="text-text-secondary hover:bg-hover-subtle focus:ring-accent rounded-sm p-1.5 focus:ring-1 focus:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {displayEdit ? (
            <ContactForm
              key={`edit-${displayEdit.id}`}
              defaultValues={existing}
              isPending={isPending}
              onSubmit={handleSubmit}
              onCancel={onClose}
            />
          ) : (
            <ContactForm
              key="create"
              isPending={isPending}
              onSubmit={handleSubmit}
              onCancel={onClose}
            />
          )}
        </div>
      </div>
    </>
  )
}
