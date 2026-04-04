import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2 } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { useRegister } from '@/hooks/mutations/useRegister'
import toast from 'react-hot-toast'

const registerSchema = z
  .object({
    name: z.string().min(2, '이름은 2자 이상 입력하세요'),
    email: z.string().email('유효한 이메일 주소를 입력하세요'),
    password: z
      .string()
      .min(8, '비밀번호는 8자 이상이어야 합니다')
      .regex(
        /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/,
        '영문, 숫자, 특수문자를 모두 포함해야 합니다'
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: '비밀번호가 일치하지 않습니다',
    path: ['confirmPassword'],
  })

type RegisterFormData = z.infer<typeof registerSchema>

export function RegisterPage() {
  const navigate = useNavigate()
  const [isSuccess, setIsSuccess] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  })

  const { mutate, isPending } = useRegister()

  const onSubmit = (data: RegisterFormData) => {
    mutate(
      { name: data.name, email: data.email, password: data.password },
      {
        onSuccess: () => setIsSuccess(true),
        onError: (err: unknown) => {
          const status = (err as { response?: { status: number } })?.response?.status
          if (status === 409) {
            setError('email', { message: '이미 사용 중인 이메일입니다' })
          } else {
            toast.error('등록 신청 중 오류가 발생했습니다')
          }
        },
      }
    )
  }

  if (isSuccess) {
    return (
      <NeuCard className="w-full max-w-md text-center">
        <CheckCircle2 className="w-16 h-16 text-[#22C55E] mx-auto mb-4" />
        <h2 className="text-xl font-bold text-[#E2E8F2] mb-2">등록 신청이 완료되었습니다</h2>
        <p className="text-sm text-[#8B97AD] mb-6">관리자 승인 후 로그인 가능합니다</p>
        <NeuButton className="w-full" onClick={() => navigate('/login')}>
          로그인 페이지로
        </NeuButton>
      </NeuCard>
    )
  }

  return (
    <NeuCard className="w-full max-w-md">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-[#00D4FF]">Synapse-V</h1>
        <p className="mt-1 text-sm text-[#8B97AD]">사용자 등록 신청</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <NeuInput
          id="name"
          label="이름"
          placeholder="홍길동"
          error={errors.name?.message}
          {...register('name')}
        />
        <NeuInput
          id="email"
          type="email"
          label="이메일"
          placeholder="user@company.com"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <NeuInput
          id="password"
          type="password"
          label="비밀번호"
          placeholder="영문+숫자+특수문자 8자 이상"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <NeuInput
          id="confirmPassword"
          type="password"
          label="비밀번호 확인"
          placeholder="비밀번호 재입력"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <NeuButton type="submit" className="w-full mt-6" loading={isPending}>
          등록 신청
        </NeuButton>
      </form>

      <p className="mt-4 text-center text-sm text-[#8B97AD]">
        이미 계정이 있으신가요?{' '}
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="text-[#00D4FF] hover:underline font-medium"
        >
          로그인
        </button>
      </p>
    </NeuCard>
  )
}
