import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { Pencil, Trash2, Users } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { useContacts } from '@/hooks/queries/useContacts'
import { useDeleteContact } from '@/hooks/mutations/useDeleteContact'
import { formatKST } from '@/lib/utils'
import type { Contact } from '@/types/contact'

export function ContactListPage() {
  const navigate = useNavigate()
  const { data: contacts = [], isLoading } = useContacts()
  const deleteMutation = useDeleteContact()

  const [search, setSearch] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q),
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
          placeholder="이름 또는 이메일 검색"
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
                {['이름', '이메일', 'Teams UPN', '알림 채널', 'LLM 키', '등록일', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#8B97AD]">
                    {h}
                  </th>
                ))}
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
        <div className="flex flex-wrap gap-1">
          {contact.webhook_url && <NeuBadge variant="normal">Webhook</NeuBadge>}
          {contact.teams_upn && <NeuBadge variant="info">Teams</NeuBadge>}
          {!contact.webhook_url && !contact.teams_upn && <span className="text-[#5A6478]">-</span>}
        </div>
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
