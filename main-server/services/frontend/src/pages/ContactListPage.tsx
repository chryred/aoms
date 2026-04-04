import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
    return contacts.filter(c =>
      c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q)
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
        action={
          <NeuButton onClick={() => navigate('/contacts/new')}>
            담당자 등록
          </NeuButton>
        }
      />

      <div className="mb-4 max-w-xs">
        <NeuInput
          placeholder="이름 또는 이메일 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="w-10 h-10" />}
          title="담당자가 없습니다"
          cta={{ label: '담당자 등록', onClick: () => navigate('/contacts/new') }}
        />
      ) : (
        <div className="rounded-2xl bg-[#E8EBF0] shadow-[6px_6px_12px_#C8CBD4,-6px_-6px_12px_#FFFFFF] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#C0C4CF]">
                {['이름', '이메일', 'Teams UPN', '알림 채널', 'LLM 키', '등록일', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#4A5568]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  onEdit={() => navigate(`/contacts/${c.id}/edit`)}
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
          <div className="absolute inset-0 bg-black/30" onClick={() => setConfirmId(null)} />
          <div className="relative bg-[#E8EBF0] rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-[#1A1F2E] mb-2">담당자 삭제</h3>
            <p className="text-sm text-[#4A5568] mb-4">
              이 담당자가 연결된 시스템에서 제거됩니다. 계속하시겠습니까?
            </p>
            <div className="flex gap-2 justify-end">
              <NeuButton variant="ghost" onClick={() => setConfirmId(null)}>취소</NeuButton>
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

function ContactRow({ contact, onEdit, onDelete }: {
  contact: Contact
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <tr className="border-b border-[#C0C4CF] last:border-0 hover:bg-[rgba(0,0,0,0.02)] transition-colors">
      <td className="px-4 py-3 font-medium text-[#1A1F2E]">{contact.name}</td>
      <td className="px-4 py-3 text-[#4A5568]">{contact.email ?? '-'}</td>
      <td className="px-4 py-3 text-[#4A5568]">{contact.teams_upn ?? '-'}</td>
      <td className="px-4 py-3">
        <div className="flex gap-1 flex-wrap">
          {contact.webhook_url && <NeuBadge variant="normal">Webhook</NeuBadge>}
          {contact.teams_upn && <NeuBadge variant="info">Teams</NeuBadge>}
          {!contact.webhook_url && !contact.teams_upn && <span className="text-[#4A5568]">-</span>}
        </div>
      </td>
      <td className="px-4 py-3 text-[#4A5568]">
        {contact.llm_api_key ? contact.llm_api_key : '-'}
      </td>
      <td className="px-4 py-3 text-[#4A5568]">{formatKST(contact.created_at, 'date')}</td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button onClick={onEdit} className="text-[#6366F1] hover:text-[#4F46E5]" aria-label="수정">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={onDelete} className="text-[#4A5568] hover:text-[#DC2626]" aria-label="삭제">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  )
}
