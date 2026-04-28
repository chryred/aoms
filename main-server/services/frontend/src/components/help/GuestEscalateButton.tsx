import { useState } from 'react'
import { PhoneCall, X } from 'lucide-react'
import { helpApi } from '@/api/help'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { cn } from '@/lib/utils'

interface GuestEscalateButtonProps {
  sessionId: string
  onEscalated: (incidentId: number) => void
}

export function GuestEscalateButton({ sessionId, onEscalated }: GuestEscalateButtonProps) {
  const [showModal, setShowModal] = useState(false)
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    setLoading(true)
    setError('')
    try {
      const resp = await helpApi.escalate(sessionId, description || undefined)
      onEscalated(resp.incident_id)
      setShowModal(false)
    } catch {
      setError('에스컬레이션 처리 중 오류가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className={cn(
          'text-text-secondary hover:text-warning flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm transition-colors',
          'border-border hover:border-warning border',
        )}
      >
        <PhoneCall className="h-3.5 w-3.5" />
        담당자 연결
      </button>

      {showModal && (
        <div className="bg-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="bg-surface shadow-neu-flat w-full max-w-sm rounded-sm">
            <div className="border-border flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-text-primary text-sm font-semibold">담당자 연결</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                disabled={loading}
                className="text-text-secondary hover:text-text-primary rounded-sm p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-4 py-4">
              <p className="text-text-secondary mb-3 text-sm">
                담당자에게 문의를 접수합니다. 추가로 전달할 내용이 있으면 입력해주세요.
              </p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="추가 내용 (선택)"
                rows={3}
                className={cn(
                  'w-full rounded-sm px-3 py-2 text-sm',
                  'bg-bg-base text-text-primary placeholder:text-text-secondary',
                  'shadow-neu-inset focus:ring-accent focus:ring-1 focus:outline-none',
                  'resize-none',
                )}
              />
              {error && <p className="text-critical mt-2 text-xs">{error}</p>}
            </div>

            <div className="border-border flex gap-2 border-t px-4 py-3">
              <NeuButton
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => setShowModal(false)}
                disabled={loading}
              >
                취소
              </NeuButton>
              <NeuButton
                variant="primary"
                size="sm"
                className="flex-1"
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading ? '접수 중...' : '접수하기'}
              </NeuButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
