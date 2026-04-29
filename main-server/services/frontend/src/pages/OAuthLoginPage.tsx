import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { oauthApi } from '@/api/oauth'
import toast from 'react-hot-toast'

const schema = z.object({
  email: z.string().email('유효한 이메일을 입력하세요'),
  password: z.string().min(1, '비밀번호를 입력하세요'),
})
type FormData = z.infer<typeof schema>

export function OAuthLoginPage() {
  const [searchParams] = useSearchParams()
  const formRef = useRef<HTMLFormElement>(null)
  const [loginDone, setLoginDone] = useState(false)

  const clientId = searchParams.get('client_id') ?? ''
  const redirectUri = searchParams.get('redirect_uri') ?? ''
  const scope = searchParams.get('scope') ?? 'openid profile email'
  const state = searchParams.get('state') ?? undefined
  const nonce = searchParams.get('nonce') ?? undefined
  const clientName = searchParams.get('client_name') ?? clientId

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const triggerShake = () => {
    const el = formRef.current
    if (!el) return
    el.classList.remove('animate-shake')
    void el.offsetWidth
    el.classList.add('animate-shake')
    setTimeout(() => el.classList.remove('animate-shake'), 500)
  }

  const { mutate, isPending } = useMutation({
    mutationFn: (data: FormData) =>
      oauthApi.authorize({
        ...data,
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        nonce,
      }),
    onSuccess: ({ redirect_url }) => {
      setLoginDone(true)
      setTimeout(() => {
        window.location.href = redirect_url
      }, 500)
    },
    onError: async (err: unknown) => {
      const resp = (err as { response?: Response })?.response
      const status = resp?.status
      if (status === 401) {
        setError('password', { message: '이메일 또는 비밀번호가 올바르지 않습니다' })
      } else if (status === 403) {
        setError('email', { message: '관리자 승인 대기 중인 계정입니다' })
      } else {
        toast.error('로그인 중 오류가 발생했습니다')
      }
      triggerShake()
    },
  })

  if (!clientId || !redirectUri) {
    return (
      <div className="bg-bg-deep flex min-h-screen items-center justify-center">
        <NeuCard className="w-full max-w-md text-center">
          <p className="text-critical text-sm">잘못된 접근입니다. client_id와 redirect_uri가 필요합니다.</p>
        </NeuCard>
      </div>
    )
  }

  return (
    <div className="bg-bg-deep flex min-h-screen items-center justify-center px-4">
      <NeuCard className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="font-lora text-text-primary text-2xl font-bold italic">Synapse-V</h1>
          <p className="text-text-secondary mt-1 text-sm">백화점 통합 모니터링 시스템</p>
        </div>

        <div className="border-border bg-bg-base mb-6 rounded-sm border px-4 py-3 text-sm">
          <p className="text-text-secondary text-xs">다음 앱에 로그인합니다</p>
          <p className="text-text-primary mt-0.5 font-medium">{clientName}</p>
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
            placeholder="user@company.com"
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

          <NeuButton type="submit" className="mt-6 w-full" disabled={isPending || loginDone}>
            {loginDone ? (
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
              <span className="btn-arc mx-auto block" aria-label="로그인 중" />
            ) : (
              '로그인하고 계속'
            )}
          </NeuButton>
        </form>

        <p className="font-lora text-text-disabled mt-6 text-center text-xs italic">
          © 2026 Synapse-V. All rights reserved.
        </p>
      </NeuCard>
    </div>
  )
}
