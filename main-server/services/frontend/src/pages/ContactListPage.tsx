import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Trash2, Users } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ContactFormDrawer } from '@/components/contacts/ContactFormDrawer'
import { useContacts } from '@/hooks/queries/useContacts'
import { useDeleteContact } from '@/hooks/mutations/useDeleteContact'
import { formatKST } from '@/lib/utils'
import type { Contact, ContactSystem } from '@/types/contact'

function SystemsCell({ systems, contactName }: { systems: ContactSystem[]; contactName: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)

  const showPopover = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 6, left: rect.left })
    }
    setOpen(true)
  }

  const hidePopover = () => setOpen(false)

  if (systems.length === 0) return <span className="text-text-disabled">-</span>
  if (systems.length === 1) return <NeuBadge variant="muted">{systems[0].display_name}</NeuBadge>

  return (
    <>
      <button
        ref={triggerRef}
        onMouseEnter={showPopover}
        onMouseLeave={hidePopover}
        onFocus={showPopover}
        onBlur={hidePopover}
        onKeyDown={(e) => {
          if (e.key === 'Escape') hidePopover()
        }}
        aria-label={`${contactName}의 연결된 시스템 보기 (${systems.length}개)`}
        className="bg-border text-text-secondary hover:bg-surface hover:text-text-primary rounded-sm px-2.5 py-1 text-xs transition-colors"
      >
        보기 ({systems.length})
      </button>

      {open &&
        createPortal(
          <div
            className="border-border bg-bg-base shadow-neu-flat fixed z-50 min-w-[160px] rounded-sm border p-3"
            style={{ top: pos.top, left: pos.left }}
            onMouseEnter={showPopover}
            onMouseLeave={hidePopover}
          >
            <div className="space-y-1.5">
              {systems.map((s) => (
                <div key={s.id} className="flex flex-col">
                  <span className="text-text-primary text-sm">{s.display_name}</span>
                  <span className="text-text-disabled text-xs">{s.system_name}</span>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

export function ContactListPage() {
  const { data: contacts = [], isLoading } = useContacts()
  const deleteMutation = useDeleteContact()

  const [search, setSearch] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Contact | null>(null)

  const confirmDialogRef = useRef<HTMLDivElement>(null)

  const confirmContact = confirmId !== null ? contacts.find((c) => c.id === confirmId) : null

  useEffect(() => {
    if (confirmId !== null) {
      confirmDialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    }
  }, [confirmId])

  const openCreate = () => {
    setEditTarget(null)
    setDrawerOpen(true)
  }
  const openEdit = (contact: Contact) => {
    setEditTarget(contact)
    setDrawerOpen(true)
  }
  const closeDrawer = () => setDrawerOpen(false)

  const openConfirm = (id: number) => {
    deleteMutation.reset()
    setConfirmId(id)
  }
  const closeConfirm = () => {
    deleteMutation.reset()
    setConfirmId(null)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return contacts
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        c.systems.some(
          (s) =>
            s.display_name.toLowerCase().includes(q) || s.system_name.toLowerCase().includes(q),
        ),
    )
  }, [contacts, search])

  function handleDelete(id: number) {
    deleteMutation.mutate(id, { onSuccess: () => setConfirmId(null) })
  }

  const handleConfirmKeyDown = (e: { key: string; shiftKey: boolean; preventDefault(): void }) => {
    if (e.key === 'Escape') {
      closeConfirm()
      return
    }
    if (e.key === 'Tab') {
      const focusable = confirmDialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  if (isLoading) return <LoadingSkeleton />

  return (
    <div>
      <PageHeader
        title="담당자 관리"
        action={<NeuButton onClick={openCreate}>담당자 등록</NeuButton>}
      />

      <div className="mb-4 max-w-xs">
        <NeuInput
          aria-label="담당자 검색"
          placeholder="이름, 이메일, 시스템 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="담당자가 없습니다"
          cta={{ label: '담당자 등록', onClick: openCreate }}
        />
      ) : (
        /* overflow-x-auto: 모바일에서 6컬럼 테이블 가로 스크롤 처리 */
        <div className="bg-bg-base shadow-neu-flat overflow-x-auto rounded-sm">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-border border-b">
                {(['이름', '이메일', 'Teams UPN', '연결된 시스템', '등록일', ''] as const).map(
                  (h, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="text-text-secondary px-4 py-3 text-left text-xs font-semibold"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  onEdit={() => openEdit(c)}
                  onDelete={() => openConfirm(c.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ContactFormDrawer open={drawerOpen} onClose={closeDrawer} editTarget={editTarget} />

      {/* 삭제 확인 다이얼로그 */}
      {confirmId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onKeyDown={handleConfirmKeyDown}
        >
          <div className="bg-overlay absolute inset-0" onClick={closeConfirm} aria-hidden="true" />
          <div
            ref={confirmDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            className="border-border bg-bg-base shadow-neu-flat relative mx-4 w-full max-w-sm rounded-sm border p-6"
          >
            <h3
              id="confirm-delete-title"
              className="text-text-primary mb-2 text-base font-semibold"
            >
              담당자 삭제
            </h3>
            <p className="text-text-secondary mb-1 text-sm">
              {confirmContact && confirmContact.systems.length > 0
                ? confirmContact.systems.length <= 3
                  ? `${confirmContact.systems.map((s) => s.display_name).join(', ')}에서 연결이 해제됩니다.`
                  : `${confirmContact.systems.length}개 시스템에서 연결이 해제됩니다.`
                : '이 담당자를 삭제합니다.'}
            </p>
            <p className="text-text-secondary mb-4 text-sm">계속하시겠습니까?</p>
            {deleteMutation.isError && (
              <p className="text-critical mb-3 text-sm">삭제에 실패했습니다. 다시 시도해 주세요.</p>
            )}
            <div className="flex justify-end gap-2">
              <NeuButton variant="ghost" onClick={closeConfirm}>
                취소
              </NeuButton>
              <NeuButton
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={() => handleDelete(confirmId)}
              >
                삭제
              </NeuButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ContactRow({
  contact,
  onEdit,
  onDelete,
}: {
  contact: Contact
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <tr className="border-border hover:bg-hover-subtle border-b transition-colors last:border-0">
      <td className="text-text-primary px-4 py-3 font-medium">{contact.name}</td>
      <td className="text-text-secondary px-4 py-3">{contact.email ?? '-'}</td>
      <td className="text-text-secondary px-4 py-3">{contact.teams_upn ?? '-'}</td>
      <td className="px-4 py-3">
        <SystemsCell systems={contact.systems} contactName={contact.name} />
      </td>
      <td className="text-text-secondary px-4 py-3">{formatKST(contact.created_at, 'date')}</td>
      <td className="px-4 py-3">
        <div className="flex gap-3">
          <button
            onClick={onEdit}
            title="수정"
            aria-label="수정"
            className="text-text-secondary hover:text-accent focus:ring-accent focus:ring-offset-bg-base rounded-sm p-1.5 transition-colors duration-150 focus:ring-1 focus:outline-none"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            title="삭제"
            aria-label="삭제"
            className="text-text-secondary hover:text-critical focus:ring-critical focus:ring-offset-bg-base rounded-sm p-1.5 transition-colors duration-150 focus:ring-1 focus:outline-none"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  )
}
