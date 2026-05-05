import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { useSystems } from '@/hooks/queries/useSystems'
import { useCreateIncident } from '@/hooks/queries/useIncidents'

const MODAL_DESC_ID = 'incident-create-modal-desc'
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

interface IncidentCreateModalProps {
  open: boolean
  onClose: () => void
  defaultSystemId?: number
}

export function IncidentCreateModal({ open, onClose, defaultSystemId }: IncidentCreateModalProps) {
  const { data: systems = [] } = useSystems()
  const { mutate: create, isPending } = useCreateIncident()

  const [systemId, setSystemId] = useState<string>(defaultSystemId ? String(defaultSystemId) : '')
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState('warning')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<{ systemId?: string; title?: string }>({})

  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setSystemId(defaultSystemId ? String(defaultSystemId) : '')
      setTitle('')
      setSeverity('warning')
      setNotes('')
      setErrors({})
      setTimeout(() => titleRef.current?.focus(), 50)
    }
  }, [open, defaultSystemId])

  // Focus trap + Escape
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))

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

  const validate = () => {
    const next: typeof errors = {}
    if (!systemId) next.systemId = '시스템을 선택하세요'
    if (!title.trim()) next.title = '제목을 입력하세요'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    create(
      { system_id: Number(systemId), title: title.trim(), severity, notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          toast.success('인시던트가 등록됐습니다')
          onClose()
        },
        onError: () => toast.error('등록에 실패했습니다. 다시 시도해 주세요.'),
      },
    )
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="인시던트 등록"
      aria-describedby={MODAL_DESC_ID}
    >
      <div className="bg-overlay absolute inset-0" onClick={onClose} aria-hidden="true" role="presentation" />

      <div
        ref={dialogRef}
        className="bg-surface shadow-neu-flat border-border relative z-10 w-full max-w-md rounded-sm border p-6"
      >
        {/* 헤더 */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-text-primary text-base font-semibold">인시던트 등록</h2>
            <p id={MODAL_DESC_ID} className="text-text-secondary mt-0.5 text-xs">
              자동 알림 없이 운영자가 직접 사건을 등록합니다
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-text-disabled hover:text-text-secondary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 폼 */}
        <div className="space-y-4">
          <NeuSelect
            label="시스템"
            id="incident-system"
            value={systemId}
            onChange={(e) => setSystemId(e.target.value)}
            aria-label="시스템 선택"
            error={errors.systemId}
          >
            <option value="">시스템 선택</option>
            {systems.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.display_name}
              </option>
            ))}
          </NeuSelect>

          <NeuInput
            ref={titleRef}
            id="incident-title"
            label="제목"
            placeholder="장애 현상을 간략히 기술하세요"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
            }}
            error={errors.title}
          />

          <NeuSelect
            label="심각도"
            id="incident-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            aria-label="심각도 선택"
          >
            <option value="critical">Critical — 서비스 중단·심각 영향</option>
            <option value="warning">Warning — 부분 저하·잠재 위험</option>
            <option value="info">Info — 모니터링 참고 사항</option>
          </NeuSelect>

          <NeuTextarea
            id="incident-notes"
            label="메모 (선택)"
            placeholder="상황 설명, 최초 인지 경위 등을 기록하세요"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* 액션 */}
        <div className="mt-6 flex justify-end gap-2">
          <NeuButton variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            취소
          </NeuButton>
          <NeuButton size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending ? '등록 중...' : '등록'}
          </NeuButton>
        </div>
      </div>
    </div>
  )
}
