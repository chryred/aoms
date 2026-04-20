import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X } from 'lucide-react'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { SystemContactPanel } from '@/components/contacts/SystemContactPanel'
import { SystemHostPanel } from '@/components/system/SystemHostPanel'
import { useCreateSystem } from '@/hooks/mutations/useCreateSystem'
import { useUpdateSystem } from '@/hooks/mutations/useUpdateSystem'
import type { System } from '@/types/system'

const schema = z.object({
  system_name: z
    .string()
    .min(1, '필수 항목입니다')
    .regex(/^[a-z0-9_-]+$/, '소문자, 숫자, -_ 만 가능합니다'),
  display_name: z.string().min(1, '필수 항목입니다'),
  status: z.enum(['active', 'inactive']).default('active'),
  teams_webhook_url: z.string().url('올바른 URL 형식이 아닙니다').optional().or(z.literal('')),
  description: z.string().optional(),
})
type FormData = z.infer<typeof schema>

interface SystemFormDrawerProps {
  open: boolean
  onClose: () => void
  onCreated?: (system: System) => void
  editTarget?: System
}

export function SystemFormDrawer({ open, onClose, onCreated, editTarget }: SystemFormDrawerProps) {
  // 닫힘 애니메이션 중에도 컨텐츠 유지
  const lastEditRef = useRef<System | undefined>(editTarget)
  if (open) lastEditRef.current = editTarget
  const displayEdit = open ? editTarget : lastEditRef.current
  const isEdit = Boolean(displayEdit)
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
    defaultValues: { status: 'active' },
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
        status: editTarget.status,
        teams_webhook_url: editTarget.teams_webhook_url ?? '',
        description: editTarget.description ?? '',
      })
    } else {
      reset({ status: 'active' })
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
      create(cleanData, {
        onSuccess: (newSystem) => {
          if (onCreated) onCreated(newSystem)
          else onClose()
        },
      })
    }
  }

  return (
    <>
      {/* 오버레이 */}
      <div
        className={cn(
          'bg-overlay fixed inset-0 z-40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 드로어 */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label={isEdit ? '시스템 수정' : '시스템 등록'}
        className={cn(
          'border-border bg-bg-base fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[480px] flex-col border-l shadow-[-8px_0_32px_rgba(0,0,0,0.4)] transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* 헤더 */}
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-text-primary text-lg font-semibold">
            {isEdit ? '시스템 수정' : '시스템 등록'}
          </h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="text-text-secondary hover:bg-hover-subtle focus:ring-accent rounded-sm p-1.5 focus:ring-1 focus:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 폼 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <form id="system-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
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

          {/* 서버 IP 관리 — 수정 모드에서만 표시 */}
          {isEdit && displayEdit && (
            <div className="border-border mt-6 border-t pt-5">
              <p className="type-label mb-3">서버 IP</p>
              <SystemHostPanel systemId={displayEdit.id} />
            </div>
          )}

          {/* 담당자 연결 — 수정 모드에서만 표시 */}
          {isEdit && displayEdit && (
            <div className="border-border mt-6 border-t pt-5">
              <p className="type-label mb-3">담당자</p>
              <SystemContactPanel systemId={displayEdit.id} />
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="border-border flex justify-end gap-2 border-t px-6 py-4">
          <NeuButton variant="ghost" onClick={onClose}>
            취소
          </NeuButton>
          <NeuButton form="system-form" type="submit" loading={isPending}>
            {isEdit ? '수정' : '등록'}
          </NeuButton>
        </div>
      </div>
    </>
  )
}
