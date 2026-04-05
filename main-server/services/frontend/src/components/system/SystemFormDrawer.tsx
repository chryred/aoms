import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { useCreateSystem } from '@/hooks/mutations/useCreateSystem'
import { useUpdateSystem } from '@/hooks/mutations/useUpdateSystem'
import type { System } from '@/types/system'

const schema = z.object({
  system_name: z
    .string()
    .min(1, '필수 항목입니다')
    .regex(/^[a-z0-9_-]+$/, '소문자, 숫자, -_ 만 가능합니다'),
  display_name: z.string().min(1, '필수 항목입니다'),
  host: z.string().min(1, '필수 항목입니다'),
  os_type: z.enum(['linux', 'windows']),
  system_type: z.enum(['web', 'was', 'db', 'middleware', 'other']),
  status: z.enum(['active', 'inactive']).default('active'),
  teams_webhook_url: z.string().url('올바른 URL 형식이 아닙니다').optional().or(z.literal('')),
  description: z.string().optional(),
})
type FormData = z.infer<typeof schema>

interface SystemFormDrawerProps {
  open: boolean
  onClose: () => void
  editTarget?: System
}

export function SystemFormDrawer({ open, onClose, editTarget }: SystemFormDrawerProps) {
  const isEdit = Boolean(editTarget)
  const navigate = useNavigate()
  const drawerRef = useRef<HTMLDivElement>(null)
  const { mutate: create, isPending: isCreating } = useCreateSystem()
  const { mutate: update, isPending: isUpdating } = useUpdateSystem(editTarget?.id ?? 0)
  const isPending = isCreating || isUpdating

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { os_type: 'linux', system_type: 'web', status: 'active' },
  })

  // Focus trap + ESC close
  useEffect(() => {
    if (!open) return
    const drawer = drawerRef.current
    if (!drawer) return

    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE))
    getFocusable()[0]?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = getFocusable()
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (editTarget) {
      reset({
        system_name: editTarget.system_name,
        display_name: editTarget.display_name,
        host: editTarget.host,
        os_type: editTarget.os_type,
        system_type: editTarget.system_type,
        status: editTarget.status,
        teams_webhook_url: editTarget.teams_webhook_url ?? '',
        description: editTarget.description ?? '',
      })
    } else {
      reset({ os_type: 'linux', system_type: 'web', status: 'active' })
    }
  }, [editTarget, reset, open])

  const onSubmit = (data: FormData) => {
    const cleanData = {
      ...data,
      teams_webhook_url: data.teams_webhook_url || undefined,
      description: data.description || undefined,
    }
    if (isEdit) {
      const { system_name: _, ...updateData } = cleanData
      update(updateData, { onSuccess: onClose })
    } else {
      create(cleanData, { onSuccess: onClose })
    }
  }

  if (!open) return null

  return (
    <>
      {/* 오버레이 */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      {/* 드로어 */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? '시스템 수정' : '시스템 등록'}
        className="fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[480px] flex-col border-l border-[#2B2F37] bg-[#1E2127] shadow-[-8px_0_32px_rgba(0,0,0,0.4)]"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-[#2B2F37] px-6 py-4">
          <h2 className="text-lg font-semibold text-[#E2E8F2]">
            {isEdit ? '시스템 수정' : '시스템 등록'}
          </h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-sm p-1.5 text-[#8B97AD] hover:bg-[rgba(255,255,255,0.05)] focus:ring-1 focus:ring-[#00D4FF] focus:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 폼 */}
        <form
          id="system-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
          noValidate
        >
          <NeuInput
            id="system_name"
            label="시스템 ID (system_name) *"
            placeholder="my-system"
            disabled={isEdit}
            error={errors.system_name?.message}
            {...register('system_name')}
          />
          <NeuInput
            id="display_name"
            label="표시 이름 *"
            placeholder="My System"
            error={errors.display_name?.message}
            {...register('display_name')}
          />
          <NeuInput
            id="host"
            label="호스트 *"
            placeholder="192.168.1.1"
            error={errors.host?.message}
            {...register('host')}
          />
          <div className="grid grid-cols-2 gap-3">
            <NeuSelect
              id="os_type"
              label="OS *"
              error={errors.os_type?.message}
              {...register('os_type')}
            >
              <option value="linux">Linux</option>
              <option value="windows">Windows</option>
            </NeuSelect>
            <NeuSelect
              id="system_type"
              label="타입 *"
              error={errors.system_type?.message}
              {...register('system_type')}
            >
              <option value="web">Web</option>
              <option value="was">WAS</option>
              <option value="db">DB</option>
              <option value="middleware">Middleware</option>
              <option value="other">기타</option>
            </NeuSelect>
          </div>
          <NeuSelect id="status" label="상태" {...register('status')}>
            <option value="active">운영 중</option>
            <option value="inactive">비활성</option>
          </NeuSelect>
          <NeuInput
            id="teams_webhook_url"
            label="Teams Webhook URL"
            placeholder="https://..."
            error={errors.teams_webhook_url?.message}
            {...register('teams_webhook_url')}
          />
          <NeuTextarea
            id="description"
            label="설명"
            placeholder="시스템에 대한 간단한 설명"
            rows={3}
            {...register('description')}
          />
        </form>

        {/* 푸터 */}
        <div className="flex items-center justify-between border-t border-[#2B2F37] px-6 py-4">
          <div>
            {isEdit && editTarget && (
              <NeuButton
                type="button"
                variant="glass"
                onClick={() => {
                  onClose()
                  navigate(ROUTES.systemWizard(editTarget.id))
                }}
              >
                <Plus className="h-4 w-4" />
                수집기 추가
              </NeuButton>
            )}
          </div>
          <div className="flex gap-2">
            <NeuButton variant="ghost" onClick={onClose}>
              취소
            </NeuButton>
            <NeuButton form="system-form" type="submit" loading={isPending}>
              {isEdit ? '수정' : '등록'}
            </NeuButton>
          </div>
        </div>
      </div>
    </>
  )
}
