import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMe } from '@/hooks/queries/useMe'
import { useUpdateMe } from '@/hooks/mutations/useUpdateMe'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { UserRoleBadge } from '@/components/user/UserStatusBadge'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'

const profileSchema = z.object({
  name: z.string().min(2, '이름은 2자 이상 입력하세요'),
})

const passwordSchema = z
  .object({
    current_password: z.string().min(1, '현재 비밀번호를 입력하세요'),
    new_password: z
      .string()
      .min(8, '비밀번호는 8자 이상이어야 합니다')
      .regex(
        /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/,
        '영문, 숫자, 특수문자를 모두 포함해야 합니다',
      ),
    confirm_password: z.string(),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: '비밀번호가 일치하지 않습니다',
    path: ['confirm_password'],
  })

type ProfileFormData = z.infer<typeof profileSchema>
type PasswordFormData = z.infer<typeof passwordSchema>

export function ProfilePage() {
  const { data: me, isLoading } = useMe()
  const { mutate: updateMe, isPending } = useUpdateMe()
  const [isEditing, setIsEditing] = useState(false)
  const [isPasswordOpen, setIsPasswordOpen] = useState(false)

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
  })

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
  })

  const handleProfileSubmit = (data: ProfileFormData) => {
    updateMe(
      { name: data.name },
      {
        onSuccess: () => {
          setIsEditing(false)
          profileForm.reset({ name: data.name })
        },
      },
    )
  }

  const handlePasswordSubmit = (data: PasswordFormData) => {
    updateMe(
      { current_password: data.current_password, new_password: data.new_password },
      {
        onSuccess: () => {
          passwordForm.reset()
          setIsPasswordOpen(false)
        },
      },
    )
  }

  if (isLoading) return <LoadingSkeleton shape="card" />
  if (!me) return null

  return (
    <div className="space-y-6">
      <PageHeader title="내 프로필" />

      <NeuCard className="max-w-2xl">
        {/* 사용자 정보 */}
        {!isEditing ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-accent text-accent-contrast shadow-neu-flat flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold">
                  {me.name.slice(0, 1)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-text-primary font-semibold">{me.name}</span>
                    <UserRoleBadge role={me.role} />
                  </div>
                  <p className="text-text-secondary text-sm">{me.email}</p>
                </div>
              </div>
              <NeuButton
                variant="ghost"
                size="sm"
                onClick={() => {
                  profileForm.reset({ name: me.name })
                  setIsEditing(true)
                }}
              >
                정보 수정
              </NeuButton>
            </div>

            <div className="border-border grid grid-cols-2 gap-4 border-t pt-4 text-sm">
              <div>
                <p className="text-text-secondary mb-0.5 text-xs">이메일</p>
                <p className="text-text-primary font-medium">{me.email}</p>
              </div>
              <div>
                <p className="text-text-secondary mb-0.5 text-xs">권한</p>
                <UserRoleBadge role={me.role} />
              </div>
            </div>
          </div>
        ) : (
          /* 편집 폼 */
          <form onSubmit={profileForm.handleSubmit(handleProfileSubmit)} className="space-y-4">
            <h3 className="text-text-primary text-sm font-semibold">정보 수정</h3>
            <NeuInput
              id="edit-name"
              label="이름"
              error={profileForm.formState.errors.name?.message}
              {...profileForm.register('name')}
            />
            <div>
              <label className="text-text-secondary mb-1 block text-xs font-medium">이메일</label>
              <p className="border-border bg-bg-base text-text-disabled rounded-sm border px-3 py-2 text-sm">
                {me.email}
                <span className="text-text-disabled ml-2 text-xs">
                  (이메일은 변경할 수 없습니다)
                </span>
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <NeuButton type="submit" size="sm" loading={isPending}>
                저장
              </NeuButton>
              <NeuButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(false)}
              >
                취소
              </NeuButton>
            </div>
          </form>
        )}

        {/* 비밀번호 변경 아코디언 */}
        <div className="border-border mt-6 border-t pt-6">
          <button
            type="button"
            onClick={() => {
              setIsPasswordOpen((v) => !v)
              if (isPasswordOpen) passwordForm.reset()
            }}
            className="text-text-primary hover:text-accent flex items-center gap-2 text-sm font-semibold transition-colors"
          >
            비밀번호 변경
            {isPasswordOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {isPasswordOpen && (
            <form
              onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)}
              className="mt-4 space-y-4"
              noValidate
            >
              <NeuInput
                id="current-password"
                type="password"
                label="현재 비밀번호"
                autoComplete="current-password"
                error={passwordForm.formState.errors.current_password?.message}
                {...passwordForm.register('current_password')}
              />
              <NeuInput
                id="new-password"
                type="password"
                label="새 비밀번호"
                placeholder="영문+숫자+특수문자 8자 이상"
                autoComplete="new-password"
                error={passwordForm.formState.errors.new_password?.message}
                {...passwordForm.register('new_password')}
              />
              <NeuInput
                id="confirm-password"
                type="password"
                label="새 비밀번호 확인"
                autoComplete="new-password"
                error={passwordForm.formState.errors.confirm_password?.message}
                {...passwordForm.register('confirm_password')}
              />
              <div className="flex gap-3 pt-2">
                <NeuButton type="submit" size="sm" loading={isPending}>
                  비밀번호 변경
                </NeuButton>
                <NeuButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    passwordForm.reset()
                    setIsPasswordOpen(false)
                  }}
                >
                  취소
                </NeuButton>
              </div>
            </form>
          )}
        </div>
      </NeuCard>
    </div>
  )
}
