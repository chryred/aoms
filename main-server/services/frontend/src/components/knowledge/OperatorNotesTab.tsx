import { useState } from 'react'
import { Pencil, Trash2, Tag, ExternalLink } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { EmptyState } from '@/components/common/EmptyState'
import { useOperatorNotes } from '@/hooks/queries/useKnowledgeQueries'
import { useDeleteOperatorNote } from '@/hooks/mutations/useKnowledgeMutations'
import { useSystems } from '@/hooks/queries/useSystems'
import { OperatorNoteFormModal } from './OperatorNoteFormModal'
import { formatKST } from '@/lib/utils'
import type { OperatorNote } from '@/types/knowledge'

const PAGE_SIZE = 20

interface OperatorNotesTabProps {
  /** KnowledgePage에서 전달 — 외부에서 신규 노트 모달 트리거 가능하도록 */
  openCreateModal?: boolean
  prefillQuestion?: string
  onModalClosed?: () => void
}

export function OperatorNotesTab({
  openCreateModal,
  prefillQuestion,
  onModalClosed,
}: OperatorNotesTabProps) {
  const { data: systems = [] } = useSystems()
  const [filterSystemId, setFilterSystemId] = useState<string>('')
  const [offset, setOffset] = useState(0)
  const [editNote, setEditNote] = useState<OperatorNote | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const deleteNote = useDeleteOperatorNote()

  const params = {
    system_id: filterSystemId ? Number(filterSystemId) : undefined,
    limit: PAGE_SIZE,
    offset,
  }

  const { data, isLoading, isError, refetch } = useOperatorNotes(params)
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const hasPrev = offset > 0
  const hasNext = offset + PAGE_SIZE < total

  // 외부에서 열기 요청
  const isCreateOpen = openCreateModal || showCreateModal

  const handleDelete = (pointId: string) => {
    if (!confirm('이 운영자 노트를 삭제하시겠습니까?')) return
    deleteNote.mutate(pointId, { onSuccess: () => refetch() })
  }

  return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <NeuSelect
            value={filterSystemId}
            onChange={(e) => {
              setFilterSystemId(e.target.value)
              setOffset(0)
            }}
          >
            <option value="">전체 시스템</option>
            {systems.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.display_name}
              </option>
            ))}
          </NeuSelect>
        </div>
        <NeuButton size="sm" className="ml-auto" onClick={() => setShowCreateModal(true)}>
          노트 추가
        </NeuButton>
      </div>

      {isLoading && <LoadingSkeleton shape="card" count={5} />}
      {isError && <ErrorCard onRetry={refetch} />}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={<Tag className="text-text-secondary h-10 w-10" />}
          title="등록된 운영자 노트가 없습니다"
          description="자주 묻는 질문 탭에서 질문을 선택하거나, 노트 추가 버튼을 눌러 직접 등록하세요."
          cta={{ label: '노트 추가', onClick: () => setShowCreateModal(true) }}
        />
      )}

      {!isLoading && !isError && items.length > 0 && (
        <>
          <NeuCard className="overflow-hidden p-0">
            <div className="divide-border divide-y">
              {items.map((note) => (
                <NoteRow
                  key={note.point_id}
                  note={note}
                  onEdit={setEditNote}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </NeuCard>

          {/* 페이지네이션 */}
          <div className="flex items-center justify-between">
            <span className="text-text-secondary text-sm">총 {total}건</span>
            <div className="flex gap-2">
              <NeuButton
                variant="ghost"
                size="sm"
                disabled={!hasPrev}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                이전
              </NeuButton>
              <NeuButton
                variant="ghost"
                size="sm"
                disabled={!hasNext}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                다음
              </NeuButton>
            </div>
          </div>
        </>
      )}

      {/* 수정 모달 */}
      {editNote && (
        <OperatorNoteFormModal
          note={editNote}
          onClose={() => setEditNote(null)}
          onSaved={() => {
            setEditNote(null)
            refetch()
          }}
        />
      )}

      {/* 신규 생성 모달 */}
      {isCreateOpen && (
        <OperatorNoteFormModal
          prefillQuestion={prefillQuestion}
          onClose={() => {
            setShowCreateModal(false)
            onModalClosed?.()
          }}
          onSaved={() => {
            setShowCreateModal(false)
            onModalClosed?.()
            refetch()
          }}
        />
      )}
    </div>
  )
}

function NoteRow({
  note,
  onEdit,
  onDelete,
}: {
  note: OperatorNote
  onEdit: (note: OperatorNote) => void
  onDelete: (pointId: string) => void
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-text-primary text-sm font-medium">{note.question}</p>
          <p className="text-text-secondary mt-1 line-clamp-2 text-xs">{note.answer}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {note.tags.map((tag) => (
              <span
                key={tag}
                className="text-text-secondary bg-hover-subtle rounded-full px-2 py-0.5 text-[11px]"
              >
                {tag}
              </span>
            ))}
            {note.source_reference && (
              <a
                href={note.source_reference}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent flex items-center gap-0.5 text-[11px] hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                출처
              </a>
            )}
            <span className="text-text-disabled text-[11px]">
              {formatKST(note.created_at, 'datetime')}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <NeuButton
            variant="ghost"
            size="sm"
            onClick={() => onEdit(note)}
            aria-label="수정"
            className="p-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
          </NeuButton>
          <NeuButton
            variant="ghost"
            size="sm"
            onClick={() => onDelete(note.point_id)}
            aria-label="삭제"
            className="text-critical hover:text-critical p-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </NeuButton>
        </div>
      </div>
    </div>
  )
}
