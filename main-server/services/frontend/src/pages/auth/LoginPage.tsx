import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import toast from 'react-hot-toast'

const schema = z.object({
  email: z.string().email('유효한 이메일을 입력하세요'),
  password: z.string().min(1, '비밀번호를 입력하세요'),
})
type FormData = z.infer<typeof schema>

export function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const { mutate, isPending } = useMutation({
    mutationFn: authApi.login,
    onSuccess: (resp) => {
      login(resp)
      navigate('/dashboard', { replace: true })
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status: number } })?.response?.status
      if (status === 401) {
        setError('password', { message: '이메일 또는 비밀번호가 올바르지 않습니다' })
      } else {
        toast.error('로그인 중 오류가 발생했습니다')
      }
    },
  })

  return (
    <NeuCard className="w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#6366F1] text-white text-2xl font-bold shadow-[3px_3px_6px_#C8CBD4,-3px_-3px_6px_#FFFFFF]">
          A
        </div>
        <h1 className="text-2xl font-bold text-[#1A1F2E]">AOMS</h1>
        <p className="mt-1 text-sm text-[#4A5568]">백화점 통합 모니터링 시스템</p>
      </div>

      <form
        onSubmit={handleSubmit((data) => mutate(data))}
        className="space-y-4"
        noValidate
      >
        <NeuInput
          id="email"
          type="email"
          label="이메일"
          placeholder="admin@company.com"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <NeuInput
          id="password"
          type="password"
          label="비밀번호"
          placeholder="••••••••"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <NeuButton type="submit" className="w-full mt-6" loading={isPending}>
          로그인
        </NeuButton>
      </form>

      <p className="mt-6 text-center text-xs text-[#A0A4B0]">
        © 2025 AOMS. All rights reserved.
      </p>
    </NeuCard>
  )
}
