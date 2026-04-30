import { useState } from 'react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { helpApi, type HelpSessionResponse } from '@/api/help'
import { loadCache, wipeCache } from '@/lib/guestSessionCache'

interface HelpVisitorFormProps {
  onSuccess: (session: HelpSessionResponse) => void
}

export function HelpVisitorForm({ onSuccess }: HelpVisitorFormProps) {
  const [employeeId, setEmployeeId] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employeeId.trim()) {
      setError('사번을 입력해주세요.')
      return
    }
    setError('')
    setLoading(true)

    // 사번 변경 시 캐시 wipe
    const cache = loadCache()
    if (cache && cache.visitor_employee_id !== employeeId.trim()) {
      wipeCache()
    }

    try {
      const session = await helpApi.createSession({
        employee_id: employeeId.trim(),
        email: email.trim() || undefined,
      })
      onSuccess(session)
    } catch {
      setError('세션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-text-primary mb-2 text-xl font-semibold">어떤 도움이 필요하세요?</h1>
          <p className="text-text-secondary text-sm leading-relaxed">
            운영 매뉴얼·정책·시스템 관련 질문에 답해드려요.
            <br />
            사번을 입력하시면 바로 시작할 수 있어요.
          </p>
        </div>

        {/* 신뢰 신호 — 데이터 보관 정책 한 줄 */}
        <p className="text-text-disabled mb-6 text-center text-[11px] leading-relaxed">
          이전 대화는 24시간 동안 이 브라우저에만 보관돼요.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-text-secondary mb-1.5 block text-xs font-medium">
              사번 <span className="text-critical">*</span>
            </label>
            <NeuInput
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="사번 입력"
              disabled={loading}
              autoFocus
            />
          </div>

          <div>
            <label className="text-text-secondary mb-1.5 block text-xs font-medium">
              이메일 <span className="text-text-disabled">(선택)</span>
            </label>
            <NeuInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일 입력"
              disabled={loading}
            />
          </div>

          {error && <p className="text-critical text-xs">{error}</p>}

          <NeuButton type="submit" variant="primary" className="w-full" disabled={loading}>
            {loading ? '확인 중...' : '시작하기'}
          </NeuButton>
        </form>
      </div>
    </div>
  )
}
