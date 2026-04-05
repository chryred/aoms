import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useRef, useState } from 'react'
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

// 비밀번호 복잡도 계산 — 로그인 화면에서 타이핑 피드백 용도
function calcStrength(pw: string): { pct: number; color: string; label: string } {
  if (!pw) return { pct: 0, color: '#2B2F37', label: '' }
  let score = 0
  if (pw.length >= 6)  score++
  if (pw.length >= 10) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++

  if (score <= 1) return { pct: 25,  color: '#EF4444', label: '취약' }
  if (score <= 3) return { pct: 60,  color: '#F59E0B', label: '보통' }
  return             { pct: 100, color: '#22C55E', label: '강함' }
}

export function LoginPage() {
  const navigate   = useNavigate()
  const login      = useAuthStore((s) => s.login)
  const formRef    = useRef<HTMLFormElement>(null)
  const [loginDone, setLoginDone] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    setError,
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const password = watch('password', '')
  const strength = calcStrength(password)

  // 폼에 수평 흔들기 — 잘못된 자격증명 피드백
  const triggerShake = () => {
    const el = formRef.current
    if (!el) return
    el.classList.remove('animate-shake')
    void el.offsetWidth          // reflow 강제 → 같은 오류 반복 시에도 재생
    el.classList.add('animate-shake')
    setTimeout(() => el.classList.remove('animate-shake'), 500)
  }

  const { mutate, isPending } = useMutation({
    mutationFn: authApi.login,
    onSuccess: (resp) => {
      login(resp)
      setLoginDone(true)
      setTimeout(() => navigate('/dashboard', { replace: true }), 700)
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status: number } })?.response?.status
      if (status === 401) {
        setError('password', { message: '이메일 또는 비밀번호가 올바르지 않습니다' })
      } else {
        toast.error('로그인 중 오류가 발생했습니다')
      }
      triggerShake()
    },
  })

  return (
    <NeuCard className="w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-sm bg-[#00D4FF] text-[#1E2127] text-2xl font-bold shadow-[2px_2px_5px_#111317,-2px_-2px_5px_#2B2F37]">
          S
        </div>
        <h1 className="type-heading text-2xl font-bold text-[#E2E8F2] font-lora italic">Synapse-V</h1>
        <p className="mt-2 text-sm leading-relaxed text-[#8B97AD]">백화점 통합 모니터링 시스템</p>
      </div>

      <form
        ref={formRef}
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

        {/* 비밀번호 필드 + 강도 표시기 */}
        <div className="space-y-1.5">
          <NeuInput
            id="password"
            type="password"
            label="비밀번호"
            placeholder="••••••••"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
          {password && (
            <div className="flex items-center gap-2 px-0.5">
              <div className="pw-track flex-1">
                <div
                  className="pw-fill"
                  style={{
                    transform: `scaleX(${strength.pct / 100})`,
                    backgroundColor: strength.color,
                  }}
                />
              </div>
              <span
                className="type-data shrink-0 text-[10px]"
                style={{ color: strength.color }}
              >
                {strength.label}
              </span>
            </div>
          )}
        </div>

        {/* 상태 머신: idle → loading arc → success checkmark → navigate */}
        <NeuButton
          type="submit"
          className="w-full mt-6"
          disabled={isPending || loginDone}
        >
          {loginDone ? (
            // 체크마크 선 그리기 애니메이션
            <svg
              className="btn-check mx-auto fill-none stroke-current"
              width={18}
              height={18}
              viewBox="0 0 18 18"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-label="로그인 성공"
            >
              <path d="M3 9l4.5 4.5L15 5" />
            </svg>
          ) : isPending ? (
            // 회전 아크
            <span className="btn-arc mx-auto block" aria-label="로그인 중" />
          ) : (
            '로그인'
          )}
        </NeuButton>
      </form>

      <p className="mt-6 text-center text-xs text-[#5A6478] font-lora italic">
        © 2026 Synapse-V. All rights reserved.
      </p>
    </NeuCard>
  )
}
