import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ContactForm } from '@/components/contacts/ContactForm'
import { useContact } from '@/hooks/queries/useContacts'
import { useCreateContact } from '@/hooks/mutations/useCreateContact'
import { useUpdateContact } from '@/hooks/mutations/useUpdateContact'
import type { ContactCreate } from '@/types/contact'

export function ContactFormPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id?: string }>()
  const isEdit = !!id
  const contactId = Number(id ?? 0)

  const { data: existing, isLoading } = useContact(contactId)
  const createMutation = useCreateContact()
  const updateMutation = useUpdateContact(contactId)

  const isPending = createMutation.isPending || updateMutation.isPending

  function handleSubmit(data: ContactCreate) {
    if (isEdit) {
      updateMutation.mutate(data, { onSuccess: () => navigate('/contacts') })
    } else {
      createMutation.mutate(data, { onSuccess: () => navigate('/contacts') })
    }
  }

  if (isEdit && isLoading) return <LoadingSkeleton />

  return (
    <div className="max-w-lg">
      <PageHeader
        title={isEdit ? `담당자 수정 — ${existing?.name ?? ''}` : '담당자 등록'}
      />
      <div className="rounded-2xl bg-[#E8EBF0] p-6 shadow-[6px_6px_12px_#C8CBD4,-6px_-6px_12px_#FFFFFF]">
        <ContactForm
          defaultValues={existing}
          isPending={isPending}
          onSubmit={handleSubmit}
          onCancel={() => navigate(-1)}
        />
      </div>
    </div>
  )
}
