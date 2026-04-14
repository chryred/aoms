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
  llm_api_key: z.string().optional(),
  agent_code: z.string().optional(),
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
      llm_api_key: defaultValues?.llm_api_key ?? '',
      agent_code: defaultValues?.agent_code ?? '',
    },
  })

  function submit(data: FormValues) {
    const body: ContactCreate = { name: data.name }
    if (data.email) body.email = data.email
    if (data.teams_upn) body.teams_upn = data.teams_upn
    if (data.webhook_url) body.webhook_url = data.webhook_url
    // agent_code: 항상 전송 (빈 문자열이면 삭제 의도로 서버가 NULL 처리)
    body.agent_code = data.agent_code ?? ''

    // llm_api_key: 마스킹 패턴이면 미수정 → 전송 제외. 그 외엔 전송 (빈 문자열이면 삭제)
    if (!data.llm_api_key?.includes('***')) {
      body.llm_api_key = data.llm_api_key ?? ''
    }

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
      <NeuInput
        id="llm_api_key"
        label="LLM API Key"
        type="password"
        placeholder={defaultValues?.llm_api_key ? '변경하려면 새 값 입력' : ''}
        {...register('llm_api_key')}
      />
      <NeuInput id="agent_code" label="Agent Code" {...register('agent_code')} />
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
