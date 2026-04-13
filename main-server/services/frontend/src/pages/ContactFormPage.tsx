import { useNavigate, useParams } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
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
      updateMutation.mutate(data, { onSuccess: () => navigate(ROUTES.CONTACTS) })
    } else {
      createMutation.mutate(data, { onSuccess: () => navigate(ROUTES.CONTACTS) })
    }
  }

  if (isEdit && isLoading) return <LoadingSkeleton />

  return (
    <div className="max-w-lg">
      <PageHeader title={isEdit ? `담당자 수정 — ${existing?.name ?? ''}` : '담당자 등록'} />
      <div className="bg-bg-base shadow-neu-flat rounded-sm p-6">
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
