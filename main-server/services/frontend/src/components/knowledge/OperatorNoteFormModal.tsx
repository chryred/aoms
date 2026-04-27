import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { useSystems } from '@/hooks/queries/useSystems'
import {
  useCreateOperatorNote,
  useUpdateOperatorNote,
} from '@/hooks/mutations/useKnowledgeMutations'
import { cn } from '@/lib/utils'
import type { OperatorNote } from '@/types/knowledge'

interface OperatorNoteFormModalProps {
  /** 편집 모드: 기존 노트 전달 시 수정, null이면 신규 */
  note?: OperatorNote | null
  /** 신규 생성 시 질문 사전 입력 (FrequentQuestionsTab에서 호출) */
  prefillQuestion?: string
  onClose: () => void
  onSaved: () => void
}

export function OperatorNoteFormModal({
  note,
  prefillQuestion,
  onClose,
  onSaved,
}: OperatorNoteFormModalProps) {
  const { data: systems = [] } = useSystems()
  const createNote = useCreateOperatorNote()
  const updateNote = useUpdateOperatorNote()

  const [question, setQuestion] = useState(note?.question ?? prefillQuestion ?? '')
  const [answer, setAnswer] = useState(note?.answer ?? '')
  const [systemId, setSystemId] = useState<string>(note?.system_id ? String(note.system_id) : '')
  const [tagInput, setTagInput] = useState((note?.tags ?? []).join(', '))
  const [sourceRef, setSourceRef] = useState(note?.source_reference ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // 모달 오픈 시 body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const validate = () => {
    const next: Record<string, string> = {}
    if (!question.trim()) next.question = '질문을 입력하세요'
    if (!answer.trim()) next.answer = '답변을 입력하세요'
    if (!systemId) next.systemId = '시스템을 선택하세요'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return

    const tags = tagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    if (note) {
      updateNote.mutate(
        {
          pointId: note.point_id,
          body: {
            question: question.trim(),
            answer: answer.trim(),
            system_id: Number(systemId),
            tags,
            source_reference: sourceRef.trim() || null,
          },
        },
        { onSuccess: onSaved },
      )
    } else {
      createNote.mutate(
        {
          question: question.trim(),
          answer: answer.trim(),
          system_id: Number(systemId),
          tags,
          source_reference: sourceRef.trim() || null,
        },
        { onSuccess: onSaved },
      )
    }
  }

  const isPending = createNote.isPending || updateNote.isPending

  return (
    <>
      {/* 오버레이 */}
      <div className="bg-overlay fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />

      {/* 모달 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={note ? '운영자 노트 수정' : '운영자 노트 추가'}
        className={cn(
          'border-border bg-bg-base shadow-neu-flat fixed inset-x-4 top-[10%] z-50 mx-auto max-w-xl',
          'flex flex-col rounded-sm',
        )}
      >
        {/* 헤더 */}
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-text-primary text-sm font-semibold">
            {note ? '운영자 노트 수정' : '운영자 노트 추가'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm p-1 focus:ring-1 focus:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 폼 */}
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {/* 시스템 선택 */}
          <FormField label="시스템" error={errors.systemId} required>
            <NeuSelect value={systemId} onChange={(e) => setSystemId(e.target.value)}>
              <option value="">시스템 선택</option>
              {systems.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.display_name}
                </option>
              ))}
            </NeuSelect>
          </FormField>

          {/* 질문 */}
          <FormField label="질문" error={errors.question} required>
            <NeuTextarea
              rows={2}
              placeholder="사용자가 자주 묻는 질문을 입력하세요"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </FormField>

          {/* 답변 */}
          <FormField label="답변" error={errors.answer} required>
            <NeuTextarea
              rows={5}
              placeholder="운영자가 제공하는 정확한 답변을 입력하세요"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </FormField>

          {/* 출처 */}
          <FormField label="출처 참조">
            <input
              type="text"
              placeholder="예: Confluence 페이지 URL, Jira 티켓 등"
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              className={cn(
                'bg-bg-base text-text-primary placeholder:text-text-disabled',
                'shadow-neu-inset w-full rounded-sm px-3 py-2 text-sm',
                'focus:ring-accent focus:ring-1 focus:outline-none',
              )}
            />
          </FormField>

          {/* 태그 */}
          <FormField label="태그">
            <input
              type="text"
              placeholder="쉼표 구분 (예: 운영,장애,CRM)"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              className={cn(
                'bg-bg-base text-text-primary placeholder:text-text-disabled',
                'shadow-neu-inset w-full rounded-sm px-3 py-2 text-sm',
                'focus:ring-accent focus:ring-1 focus:outline-none',
              )}
            />
          </FormField>
        </div>

        {/* 푸터 */}
        <div className="border-border flex items-center justify-end gap-2 border-t px-5 py-3">
          <NeuButton variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            취소
          </NeuButton>
          <NeuButton size="sm" loading={isPending} onClick={handleSubmit}>
            {note ? '수정' : '저장'}
          </NeuButton>
        </div>
      </div>
    </>
  )
}

function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-text-secondary block text-xs font-medium">
        {label}
        {required && <span className="text-critical ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-critical text-xs">{error}</p>}
    </div>
  )
}
