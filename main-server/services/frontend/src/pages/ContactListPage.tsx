import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { Pencil, Trash2, Users, X } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { useContacts } from '@/hooks/queries/useContacts'
import { useDeleteContact } from '@/hooks/mutations/useDeleteContact'
import { formatKST } from '@/lib/utils'
import type { Contact, ContactSystem } from '@/types/contact'

function SystemsCell({ systems }: { systems: ContactSystem[] }) {
  const [popupOpen, setPopupOpen] = useState(false)

  if (systems.length === 0) return <span className="text-[#5A6478]">-</span>

  // 1개: 뱃지 그대로 표시
  if (systems.length === 1) {
    return <NeuBadge variant="muted">{systems[0].display_name}</NeuBadge>
  }

  // 2개 이상: "보기" 버튼 + 팝업
  return (
    <>
      <button
        onClick={() => setPopupOpen(true)}
        className="rounded-sm bg-[#2B2F37] px-2.5 py-1 text-xs text-[#8B97AD] transition-colors hover:bg-[#353A44] hover:text-[#E2E8F2]"
      >
        보기 ({systems.length})
      </button>

      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPopupOpen(false)} />
          <div className="relative mx-4 w-full max-w-xs rounded-sm border border-[#2B2F37] bg-[#1E2127] p-5 shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#E2E8F2]">연결된 시스템</p>
              <button
                onClick={() => setPopupOpen(false)}
                className="text-[#8B97AD] hover:text-[#E2E8F2]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              {systems.map((s) => (
                <div key={s.id} className="flex flex-col">
                  <span className="text-sm text-[#E2E8F2]">{s.display_name}</span>
                  <span className="text-xs text-[#5A6478]">{s.system_name}</span>
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
  const navigate = useNavigate()
  const { data: contacts = [], isLoading } = useContacts()
  const deleteMutation = useDeleteContact()

  const [search, setSearch] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)

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
        action={<NeuButton onClick={() => navigate(ROUTES.CONTACTS_NEW)}>담당자 등록</NeuButton>}
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
          cta={{ label: '담당자 등록', onClick: () => navigate(ROUTES.CONTACTS_NEW) }}
        />
      ) : (
        <div className="overflow-hidden rounded-sm bg-[#1E2127] shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2B2F37]">
                {['이름', '이메일', 'Teams UPN', '연결된 시스템', 'LLM 키', '등록일', ''].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-[#8B97AD]"
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
                  onEdit={() => navigate(ROUTES.contactEdit(c.id))}
                  onDelete={() => setConfirmId(c.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmId(null)} />
          <div className="relative mx-4 w-full max-w-sm rounded-sm border border-[#2B2F37] bg-[#1E2127] p-6 shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]">
            <h3 className="mb-2 text-base font-semibold text-[#E2E8F2]">담당자 삭제</h3>
            <p className="mb-4 text-sm text-[#8B97AD]">
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
    <tr className="border-b border-[#2B2F37] transition-colors last:border-0 hover:bg-[rgba(0,212,255,0.04)]">
      <td className="px-4 py-3 font-medium text-[#E2E8F2]">{contact.name}</td>
      <td className="px-4 py-3 text-[#8B97AD]">{contact.email ?? '-'}</td>
      <td className="px-4 py-3 text-[#8B97AD]">{contact.teams_upn ?? '-'}</td>
      <td className="px-4 py-3">
        <SystemsCell systems={contact.systems} />
      </td>
      <td className="px-4 py-3 text-[#8B97AD]">
        {contact.llm_api_key ? contact.llm_api_key : '-'}
      </td>
      <td className="px-4 py-3 text-[#8B97AD]">{formatKST(contact.created_at, 'date')}</td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="text-[#8B97AD] hover:text-[#00D4FF]"
            aria-label="수정"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="text-[#8B97AD] hover:text-[#EF4444]"
            aria-label="삭제"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  )
}
