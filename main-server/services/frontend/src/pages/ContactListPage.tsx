import { useMemo, useState } from 'react'
import { Pencil, Trash2, Users, X } from 'lucide-react'
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

function SystemsCell({ systems }: { systems: ContactSystem[] }) {
  const [popupOpen, setPopupOpen] = useState(false)

  if (systems.length === 0) return <span className="text-text-disabled">-</span>

  // 1개: 뱃지 그대로 표시
  if (systems.length === 1) {
    return <NeuBadge variant="muted">{systems[0].display_name}</NeuBadge>
  }

  // 2개 이상: "보기" 버튼 + 팝업
  return (
    <>
      <button
        onClick={() => setPopupOpen(true)}
        className="bg-border text-text-secondary hover:bg-surface hover:text-text-primary rounded-sm px-2.5 py-1 text-xs transition-colors"
      >
        보기 ({systems.length})
      </button>

      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="bg-overlay absolute inset-0" onClick={() => setPopupOpen(false)} />
          <div className="border-border bg-bg-base shadow-neu-flat relative mx-4 w-full max-w-xs rounded-sm border p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-text-primary text-sm font-semibold">연결된 시스템</p>
              <button
                onClick={() => setPopupOpen(false)}
                className="text-text-secondary hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              {systems.map((s) => (
                <div key={s.id} className="flex flex-col">
                  <span className="text-text-primary text-sm">{s.display_name}</span>
                  <span className="text-text-disabled text-xs">{s.system_name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
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

  const openCreate = () => {
    setEditTarget(null)
    setDrawerOpen(true)
  }
  const openEdit = (contact: Contact) => {
    setEditTarget(contact)
    setDrawerOpen(true)
  }
  const closeDrawer = () => setDrawerOpen(false)

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

  if (isLoading) return <LoadingSkeleton />

  return (
    <div>
      <PageHeader
        title="담당자 관리"
        action={<NeuButton onClick={openCreate}>담당자 등록</NeuButton>}
      />

      <div className="mb-4 max-w-xs">
        <NeuInput
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
        <div className="bg-bg-base shadow-neu-flat overflow-hidden rounded-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border border-b">
                {['이름', '이메일', 'Teams UPN', '연결된 시스템', '등록일', ''].map(
                  (h) => (
                    <th
                      key={h}
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
                  onDelete={() => setConfirmId(c.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ContactFormDrawer open={drawerOpen} onClose={closeDrawer} editTarget={editTarget} />

      {/* Confirm Dialog */}
      {confirmId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="bg-overlay absolute inset-0" onClick={() => setConfirmId(null)} />
          <div className="border-border bg-bg-base shadow-neu-flat relative mx-4 w-full max-w-sm rounded-sm border p-6">
            <h3 className="text-text-primary mb-2 text-base font-semibold">담당자 삭제</h3>
            <p className="text-text-secondary mb-4 text-sm">
              이 담당자가 연결된 시스템에서 제거됩니다. 계속하시겠습니까?
            </p>
            <div className="flex justify-end gap-2">
              <NeuButton variant="ghost" onClick={() => setConfirmId(null)}>
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
    <tr className="border-border border-b transition-colors last:border-0 hover:bg-[rgba(0,212,255,0.04)]">
      <td className="text-text-primary px-4 py-3 font-medium">{contact.name}</td>
      <td className="text-text-secondary px-4 py-3">{contact.email ?? '-'}</td>
      <td className="text-text-secondary px-4 py-3">{contact.teams_upn ?? '-'}</td>
      <td className="px-4 py-3">
        <SystemsCell systems={contact.systems} />
      </td>
      <td className="text-text-secondary px-4 py-3">{formatKST(contact.created_at, 'date')}</td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="text-text-secondary hover:text-accent"
            aria-label="수정"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="text-text-secondary hover:text-critical"
            aria-label="삭제"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  )
}
