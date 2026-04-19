import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X } from 'lucide-react'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { useUpdateUser } from '@/hooks/mutations/useUpdateUser'
import { cn } from '@/lib/utils'
import type { UserAdminOut } from '@/types/auth'

const userSchema = z.object({
  name: z.string().min(1, '이름을 입력해주세요').max(100),
  email: z.string().email('올바른 이메일 형식이 아닙니다'),
})

type FormValues = z.infer<typeof userSchema>

interface UserFormDrawerProps {
  open: boolean
  onClose: () => void
  editTarget: UserAdminOut | null
}

export function UserFormDrawer({ open, onClose, editTarget }: UserFormDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)
  const lastEditRef = useRef<UserAdminOut | null>(null)
  if (open) lastEditRef.current = editTarget
  const displayEdit = open ? editTarget : lastEditRef.current

  const updateMutation = useUpdateUser(displayEdit?.id ?? 0)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: { name: '', email: '' },
  })

  useEffect(() => {
    if (open && displayEdit) {
      reset({ name: displayEdit.name, email: displayEdit.email })
    }
  }, [open, displayEdit, reset])

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

  const onSubmit = (data: FormValues) => {
    updateMutation.mutate(data, { onSuccess: onClose })
  }

  return (
    <>
      <div
        className={cn(
          'bg-overlay fixed inset-0 z-40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label="사용자 정보 수정"
        className={cn(
          'border-border bg-bg-base fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[480px] flex-col border-l shadow-[-8px_0_32px_rgba(0,0,0,0.4)] transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-text-primary text-lg font-semibold">
            사용자 수정 — {displayEdit?.name ?? ''}
          </h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="text-text-secondary hover:bg-hover-subtle focus:ring-accent rounded-sm p-1.5 focus:ring-1 focus:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <NeuInput
              id="name"
              label="이름 *"
              placeholder="홍길동"
              error={errors.name?.message}
              {...register('name')}
            />
            <NeuInput
              id="email"
              label="이메일 *"
              type="email"
              placeholder="user@company.com"
              error={errors.email?.message}
              {...register('email')}
            />
            <p className="text-text-secondary text-xs">
              이름/이메일 변경 시 연결된 담당자 정보도 자동으로 동기화됩니다.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <NeuButton type="button" variant="ghost" onClick={onClose}>
                취소
              </NeuButton>
              <NeuButton type="submit" loading={updateMutation.isPending}>
                저장
              </NeuButton>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
