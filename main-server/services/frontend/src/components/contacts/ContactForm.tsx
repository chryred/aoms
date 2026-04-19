import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { useApprovedUsers } from '@/hooks/queries/useApprovedUsers'
import { useContacts } from '@/hooks/queries/useContacts'
import type { Contact, ContactCreate } from '@/types/contact'

const contactSchema = z.object({
  user_id: z.number({ required_error: '사용자를 선택해주세요' }).positive('사용자를 선택해주세요'),
  teams_upn: z.string().optional(),
  webhook_url: z.string().url('올바른 URL 형식이 아닙니다').optional().or(z.literal('')),
})

type FormValues = z.infer<typeof contactSchema>

interface ContactFormProps {
  defaultValues?: Partial<Contact>
  isPending: boolean
  onSubmit: (data: ContactCreate) => void
  onCancel: () => void
  isEdit?: boolean
}

export function ContactForm({
  defaultValues,
  isPending,
  onSubmit,
  onCancel,
  isEdit = false,
}: ContactFormProps) {
  const { data: approvedUsers = [] } = useApprovedUsers()
  const { data: contacts = [] } = useContacts()
  const [userSearch, setUserSearch] = useState('')

  const alreadyLinkedUserIds = new Set(contacts.map((c) => c.user_id))

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      user_id: defaultValues?.user_id ?? 0,
      teams_upn: defaultValues?.teams_upn ?? '',
      webhook_url: defaultValues?.webhook_url ?? '',
    },
  })

  const selectedUserId = watch('user_id')
  const selectRef = useRef<HTMLSelectElement>(null)

  const filteredUsers = approvedUsers.filter((u) => {
    const q = userSearch.toLowerCase()
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  function submit(data: FormValues) {
    const body: ContactCreate = { user_id: data.user_id }
    if (data.teams_upn) body.teams_upn = data.teams_upn
    if (data.webhook_url) body.webhook_url = data.webhook_url
    onSubmit(body)
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-4">
      {isEdit ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-text-secondary text-[0.8125rem] font-medium">이름</span>
            <p className="text-text-primary text-sm font-medium">{defaultValues?.name}</p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-text-secondary text-[0.8125rem] font-medium">이메일</span>
            <p className="text-text-secondary text-sm">{defaultValues?.email}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <NeuInput
            id="user-search"
            label="사용자 검색"
            placeholder="이름 또는 이메일 입력 후 Enter"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (filteredUsers.length === 1) {
                  setValue('user_id', filteredUsers[0].id, { shouldValidate: true })
                  selectRef.current?.blur()
                } else {
                  selectRef.current?.focus()
                }
              }
            }}
          />
          <NeuSelect
            id="user_id"
            label="사용자 선택 *"
            value={selectedUserId || ''}
            onChange={(e) => setValue('user_id', Number(e.target.value), { shouldValidate: true })}
            error={errors.user_id?.message}
            ref={selectRef}
          >
            <option value="">— 선택 —</option>
            {filteredUsers.map((u) => {
              const alreadyLinked =
                alreadyLinkedUserIds.has(u.id) && u.id !== defaultValues?.user_id
              return (
                <option key={u.id} value={u.id} disabled={alreadyLinked}>
                  {u.name} ({u.email}){alreadyLinked ? ' — 이미 등록됨' : ''}
                </option>
              )
            })}
          </NeuSelect>
        </div>
      )}

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
