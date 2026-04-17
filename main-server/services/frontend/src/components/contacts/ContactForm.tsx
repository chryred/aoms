import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import type { Contact, ContactCreate } from '@/types/contact'

const contactSchema = z.object({
  name: z.string().min(1, '이름을 입력해주세요').max(100),
  email: z.string().email('올바른 이메일 형식이 아닙니다').optional().or(z.literal('')),
  teams_upn: z.string().optional(),
  webhook_url: z.string().url('올바른 URL 형식이 아닙니다').optional().or(z.literal('')),
})

type FormValues = z.infer<typeof contactSchema>

interface ContactFormProps {
  defaultValues?: Partial<Contact>
  isPending: boolean
  onSubmit: (data: ContactCreate) => void
  onCancel: () => void
}

export function ContactForm({ defaultValues, isPending, onSubmit, onCancel }: ContactFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: defaultValues?.name ?? '',
      email: defaultValues?.email ?? '',
      teams_upn: defaultValues?.teams_upn ?? '',
      webhook_url: defaultValues?.webhook_url ?? '',
    },
  })

  function submit(data: FormValues) {
    const body: ContactCreate = { name: data.name }
    if (data.email) body.email = data.email
    if (data.teams_upn) body.teams_upn = data.teams_upn
    if (data.webhook_url) body.webhook_url = data.webhook_url
    onSubmit(body)
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-4">
      <NeuInput
        id="name"
        label="이름 *"
        placeholder="홍길동"
        error={errors.name?.message}
        {...register('name')}
      />
      <NeuInput
        id="email"
        label="이메일"
        type="email"
        placeholder="user@company.com"
        error={errors.email?.message}
        {...register('email')}
      />
      <NeuInput
        id="teams_upn"
        label="Teams UPN"
        placeholder="user@company.com"
        {...register('teams_upn')}
      />
      <NeuInput
        id="webhook_url"
        label="Webhook URL"
        type="url"
        placeholder="https://..."
        error={errors.webhook_url?.message}
        {...register('webhook_url')}
      />
      <div className="flex justify-end gap-2 pt-2">
        <NeuButton type="button" variant="ghost" onClick={onCancel}>
          취소
        </NeuButton>
        <NeuButton type="submit" loading={isPending}>
          저장
        </NeuButton>
      </div>
    </form>
  )
}
