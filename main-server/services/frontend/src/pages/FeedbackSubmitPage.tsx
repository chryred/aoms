import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { useCreateFeedback } from '@/hooks/mutations/useCreateFeedback'
import { useAuthStore } from '@/store/authStore'
import { ROUTES } from '@/constants/routes'

const ERROR_TYPES = [
  'DB 연결 오류',
  '메모리 부족',
  '디스크 부족',
  '네트워크 오류',
  '타임아웃',
  '애플리케이션 오류',
  '기타',
] as const

export function FeedbackSubmitPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const alertHistoryIdRaw = searchParams.get('alert_history_id') ?? ''
  const alertHistoryId = Number(alertHistoryIdRaw)
  const system = searchParams.get('system') ?? ''
  const pointId = searchParams.get('point_id') ?? ''
  const invalidId = !alertHistoryIdRaw || Number.isNaN(alertHistoryId) || alertHistoryId <= 0

  const [errorType, setErrorType] = useState<string>('DB 연결 오류')
  const [solution, setSolution] = useState('')
  const [resolver, setResolver] = useState(user?.name ?? '')
  const [done, setDone] = useState(false)

  const { mutate, isPending, isError, error, reset } = useCreateFeedback()

  const handleClose = () => {
    window.close()
    setTimeout(() => {
      if (!window.closed) navigate(ROUTES.DASHBOARD, { replace: true })
    }, 200)
  }

  if (invalidId) {
    return (
      <div className="bg-bg-base flex min-h-screen items-start justify-center p-6">
        <NeuCard className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="text-critical h-10 w-10" />
            <h1 className="type-heading text-text-primary text-xl font-semibold">
              잘못된 접근입니다
            </h1>
            <p className="text-text-secondary text-sm">
              알림 식별자(alert_history_id)가 누락되었거나 유효하지 않습니다. Teams 알림 카드에서
              다시 &lsquo;해결책 등록&rsquo; 버튼을 눌러주세요.
            </p>
            <NeuButton onClick={() => navigate(ROUTES.DASHBOARD)} className="mt-2">
              대시보드로 이동
            </NeuButton>
          </div>
        </NeuCard>
      </div>
    )
  }

  if (done) {
    return (
      <div className="bg-bg-base flex min-h-screen items-start justify-center p-6">
        <NeuCard className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="text-normal h-10 w-10" />
            <h1 className="type-heading text-text-primary text-xl font-semibold">
              해결책이 등록되었습니다
            </h1>
            <p className="text-text-secondary text-sm">
              벡터 DB에 반영되어 향후 유사 장애 대응에 활용됩니다. 이 창을 닫아도 됩니다.
            </p>
            <div className="mt-2 flex gap-2">
              <NeuButton onClick={handleClose}>창 닫기</NeuButton>
              <NeuButton variant="ghost" onClick={() => navigate(ROUTES.DASHBOARD)}>
                대시보드로
              </NeuButton>
            </div>
          </div>
        </NeuCard>
      </div>
    )
  }

  return (
    <div className="bg-bg-base flex min-h-screen items-start justify-center p-6">
      <NeuCard className="w-full max-w-xl">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="type-heading text-text-primary text-xl font-semibold">
            🔧 장애 해결책 등록
          </h1>
          {system && <NeuBadge variant="muted">시스템: {system}</NeuBadge>}
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!solution.trim() || !resolver.trim()) return
            reset()
            mutate(
              {
                alert_history_id: alertHistoryId,
                error_type: errorType,
                solution: solution.trim(),
                resolver: resolver.trim(),
              },
              { onSuccess: () => setDone(true) },
            )
          }}
        >
          <NeuSelect
            id="error-type"
            label="장애 유형"
            value={errorType}
            onChange={(e) => setErrorType(e.target.value)}
          >
            {ERROR_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NeuSelect>

          <NeuTextarea
            id="solution"
            label="해결 내용"
            rows={6}
            placeholder="수행한 조치 내용을 구체적으로 기술해 주세요..."
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
            required
          />

          <NeuInput
            id="resolver"
            label="처리자"
            placeholder="이름 또는 사번"
            value={resolver}
            onChange={(e) => setResolver(e.target.value)}
            required
          />

          {pointId && (
            <p className="text-text-disabled text-xs">
              참조 vector point: <span className="font-mono">{pointId}</span>
            </p>
          )}

          {isError && (
            <p className="text-critical text-sm">
              {(error as Error)?.message || '등록 중 오류가 발생했습니다'}
            </p>
          )}

          <NeuButton
            type="submit"
            className="w-full"
            disabled={isPending || !solution.trim() || !resolver.trim()}
          >
            {isPending ? '등록 중...' : '해결책 등록'}
          </NeuButton>
        </form>
      </NeuCard>
    </div>
  )
}

export default FeedbackSubmitPage
