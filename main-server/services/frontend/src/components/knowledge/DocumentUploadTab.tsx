import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Trash2,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { Modal } from '@/components/common/Modal'
import { useSystems } from '@/hooks/queries/useSystems'
import { useUploadDocument } from '@/hooks/mutations/useKnowledgeMutations'
import { useUploadStatus } from '@/hooks/queries/useKnowledgeQueries'
import { useKnowledgeDocuments } from '@/hooks/queries/useKnowledgeDocuments'
import { useDeleteDocument } from '@/hooks/mutations/useDeleteDocument'
import { knowledgeDocumentsApi } from '@/api/knowledge-documents'
import { cn, formatKST } from '@/lib/utils'
import type { UploadJob } from '@/types/knowledge'
import type { System } from '@/types/system'
import type { KnowledgeDocumentItem, DocumentChunk } from '@/types/knowledge-verify'

interface UploadEntry {
  localId: string
  file: File
  jobId: string | null
  status: UploadJob['status'] | 'uploading'
  systemName: string
  error?: string
  pointCount?: number
}

export function DocumentUploadTab() {
  const { data: systems = [] } = useSystems()
  const uploadMutation = useUploadDocument()

  const [selectedSystemId, setSelectedSystemId] = useState<string>('')
  const [tagInput, setTagInput] = useState('')
  const [entries, setEntries] = useState<UploadEntry[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const tags = tagInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      if (!selectedSystemId) return
      const fileArray = Array.from(files)
      fileArray.forEach((file) => {
        const localId = `${Date.now()}-${Math.random()}`
        const entry: UploadEntry = {
          localId,
          file,
          jobId: null,
          status: 'uploading',
          systemName:
            systems.find((s) => s.id === Number(selectedSystemId))?.display_name ??
            selectedSystemId,
        }
        setEntries((prev) => [entry, ...prev])

        uploadMutation.mutate(
          { file, systemId: Number(selectedSystemId), tags: tags.length > 0 ? tags : undefined },
          {
            onSuccess: (job) => {
              setEntries((prev) =>
                prev.map((e) =>
                  e.localId === localId ? { ...e, jobId: job.job_id, status: job.status } : e,
                ),
              )
            },
            onError: (err) => {
              setEntries((prev) =>
                prev.map((e) =>
                  e.localId === localId
                    ? { ...e, status: 'error', error: (err as Error).message }
                    : e,
                ),
              )
            },
          },
        )
      })
    },
    [selectedSystemId, tags, uploadMutation, systems],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files)
      }
    },
    [handleFiles],
  )

  const removeEntry = (localId: string) => {
    setEntries((prev) => prev.filter((e) => e.localId !== localId))
  }

  return (
    <div className="space-y-4">
      {/* 설정 영역 */}
      <NeuCard className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-56">
            <NeuSelect
              value={selectedSystemId}
              onChange={(e) => setSelectedSystemId(e.target.value)}
            >
              <option value="">시스템 선택 (필수)</option>
              {systems.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.display_name}
                </option>
              ))}
            </NeuSelect>
          </div>
          <div className="flex-1">
            <input
              type="text"
              placeholder="태그 (쉼표 구분, 예: 운영,장애)"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              className={cn(
                'bg-bg-base text-text-primary placeholder:text-text-disabled',
                'shadow-neu-inset w-full rounded-sm px-3 py-2 text-sm',
                'focus:ring-accent focus:ring-1 focus:outline-none',
              )}
            />
          </div>
        </div>
      </NeuCard>

      {/* 드래그앤드롭 영역 */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
        }}
        onDrop={handleDrop}
        onClick={() => selectedSystemId && fileInputRef.current?.click()}
        className={cn(
          'rounded-sm border-2 border-dashed px-6 py-10',
          'flex flex-col items-center justify-center gap-3',
          'transition-colors duration-150',
          isDragging
            ? 'border-accent bg-accent-muted'
            : selectedSystemId
              ? 'border-border hover:border-accent cursor-pointer'
              : 'border-border cursor-not-allowed opacity-50',
        )}
      >
        <Upload
          className={cn('h-8 w-8', isDragging ? 'text-accent' : 'text-text-secondary')}
          aria-hidden="true"
        />
        <div className="text-center">
          <p className="text-text-primary text-sm font-medium">
            {selectedSystemId ? '파일을 드래그하거나 클릭하여 업로드' : '시스템을 먼저 선택하세요'}
          </p>
          <p className="text-text-secondary mt-1 text-xs">PDF, TXT, MD, DOCX, PPTX 지원</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.docx,.pptx"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFiles(e.target.files)
              e.target.value = ''
            }
          }}
        />
      </div>

      {/* 업로드 목록 */}
      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((entry) => (
            <UploadEntryRow key={entry.localId} entry={entry} onRemove={removeEntry} />
          ))}
        </div>
      )}

      {/* 적재된 문서 목록 */}
      <DocumentListGrid systems={systems} />
    </div>
  )
}

function UploadEntryRow({
  entry,
  onRemove,
}: {
  entry: UploadEntry
  onRemove: (id: string) => void
}) {
  const qc = useQueryClient()
  // 서버 측 상태 폴링 (jobId가 있고 완료/실패 전인 경우)
  const polling = !!entry.jobId && entry.status !== 'done' && entry.status !== 'error'
  const { data: jobStatus } = useUploadStatus(polling ? (entry.jobId ?? null) : null)

  const resolvedStatus = jobStatus?.status ?? entry.status
  const resolvedPointCount = jobStatus?.point_count ?? entry.pointCount
  const resolvedError = jobStatus?.error ?? entry.error

  useEffect(() => {
    if (resolvedStatus === 'done') {
      void qc.invalidateQueries({ queryKey: ['knowledge', 'documents', 'list'] })
    }
  }, [resolvedStatus, qc])

  return (
    <NeuCard className="flex items-center gap-3 p-3">
      <FileText className="text-text-secondary h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-text-primary truncate text-sm font-medium">{entry.file.name}</p>
        <p className="text-text-secondary text-xs">
          {entry.systemName} · {Math.round(entry.file.size / 1024)}KB
          {resolvedPointCount !== undefined && ` · ${resolvedPointCount}개 청크`}
        </p>
        {resolvedError && <p className="text-critical mt-0.5 text-xs">{resolvedError}</p>}
      </div>
      <StatusBadge status={resolvedStatus} />
      <NeuButton
        variant="ghost"
        size="sm"
        onClick={() => onRemove(entry.localId)}
        aria-label="목록에서 제거"
        className="shrink-0 p-1"
      >
        <X className="h-3.5 w-3.5" />
      </NeuButton>
    </NeuCard>
  )
}

function StatusBadge({ status }: { status: UploadEntry['status'] }) {
  if (status === 'uploading' || status === 'queued' || status === 'embedding') {
    return <Loader2 className="text-accent h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
  }
  if (status === 'done') {
    return <CheckCircle className="text-normal h-4 w-4 shrink-0" aria-hidden="true" />
  }
  if (status === 'error') {
    return <AlertCircle className="text-critical h-4 w-4 shrink-0" aria-hidden="true" />
  }
  return null
}

// 적재된 문서 목록 그리드
function DocumentListGrid({ systems }: { systems: System[] }) {
  const { data, isLoading, isError } = useKnowledgeDocuments()
  const deleteDoc = useDeleteDocument()
  const [confirmingHash, setConfirmingHash] = useState<string | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocumentItem | null>(null)

  const items = data?.items ?? []

  const getSystemName = (systemId: number) =>
    systems.find((s) => s.id === systemId)?.display_name ?? String(systemId)

  const handleDelete = (fileHash: string) => {
    deleteDoc.mutate(fileHash, { onSuccess: () => setConfirmingHash(null) })
  }

  if (isLoading) return <LoadingSkeleton shape="card" count={3} />
  if (isError) return null

  return (
    <>
      <div className="space-y-2">
        <p className="text-text-secondary text-sm font-medium">적재된 문서 목록</p>
        {items.length === 0 ? (
          <EmptyState
            icon={<FileText className="text-text-secondary h-8 w-8" />}
            title="적재된 문서가 없습니다"
            description="위에서 문서를 업로드하면 목록에 표시됩니다."
          />
        ) : (
          <NeuCard className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border border-b">
                    <th
                      scope="col"
                      className="text-text-secondary px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap"
                    >
                      파일명
                    </th>
                    <th
                      scope="col"
                      className="text-text-secondary px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap"
                    >
                      시스템
                    </th>
                    <th
                      scope="col"
                      className="text-text-secondary min-w-[120px] px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap"
                    >
                      Point IDs
                    </th>
                    <th
                      scope="col"
                      className="text-text-secondary px-4 py-2.5 text-right text-xs font-medium whitespace-nowrap"
                    >
                      청크 수
                    </th>
                    <th
                      scope="col"
                      className="text-text-secondary px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap"
                    >
                      업로드
                    </th>
                    <th
                      scope="col"
                      className="text-text-secondary px-4 py-2.5 text-right text-xs font-medium whitespace-nowrap"
                    >
                      관리
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {items.map((item) => (
                    <tr
                      key={item.file_hash}
                      role="button"
                      tabIndex={0}
                      className="hover:bg-surface focus-visible:ring-accent cursor-pointer transition-colors focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset"
                      onClick={() => setSelectedDoc(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedDoc(item)
                        }
                      }}
                    >
                      <td className="px-4 py-2.5">
                        <span className="text-text-primary flex items-center gap-1.5 truncate font-medium">
                          <FileText className="text-text-secondary h-3.5 w-3.5 shrink-0" />
                          {item.file_name}
                        </span>
                      </td>
                      <td className="text-text-secondary px-4 py-2.5 text-xs whitespace-nowrap">
                        {getSystemName(item.system_id)}
                      </td>
                      <td className="px-4 py-2.5">
                        <PointIdsBadge pointIds={item.point_ids ?? []} />
                      </td>
                      <td className="text-text-secondary px-4 py-2.5 text-right text-xs whitespace-nowrap">
                        {item.chunk_count}
                      </td>
                      <td className="text-text-disabled px-4 py-2.5 text-xs whitespace-nowrap">
                        {formatKST(item.uploaded_at, 'datetime')}
                      </td>
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {confirmingHash === item.file_hash ? (
                          <div className="flex items-center justify-end gap-1">
                            <NeuButton
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(item.file_hash)}
                              disabled={deleteDoc.isPending}
                              className="text-critical px-2 text-xs"
                            >
                              {deleteDoc.isPending ? '삭제 중...' : '삭제'}
                            </NeuButton>
                            <NeuButton
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmingHash(null)}
                              disabled={deleteDoc.isPending}
                              className="px-2 text-xs"
                            >
                              취소
                            </NeuButton>
                          </div>
                        ) : (
                          <NeuButton
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmingHash(item.file_hash)}
                            className="text-critical hover:text-critical gap-1 px-2 text-xs"
                            aria-label={`${item.file_name} 전체 삭제`}
                          >
                            <Trash2 className="h-3 w-3" />
                            전체 삭제
                          </NeuButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </NeuCard>
        )}
      </div>

      {selectedDoc && (
        <DocumentChunksModal
          doc={selectedDoc}
          systemName={getSystemName(selectedDoc.system_id)}
          onClose={() => setSelectedDoc(null)}
        />
      )}
    </>
  )
}

function PointIdsBadge({ pointIds }: { pointIds: string[] }) {
  if (pointIds.length === 0) return <span className="text-text-disabled text-xs">—</span>
  const preview = pointIds.slice(0, 2)
  const rest = pointIds.length - preview.length
  return (
    <div className="flex flex-wrap items-center gap-1">
      {preview.map((id) => (
        <code
          key={id}
          className="bg-bg-base text-text-secondary rounded-sm px-1 py-0.5 font-mono text-[10px]"
        >
          {id.slice(0, 8)}…
        </code>
      ))}
      {rest > 0 && <span className="text-text-disabled text-xs">외 {rest}개</span>}
    </div>
  )
}

function DocumentChunksModal({
  doc,
  systemName,
  onClose,
}: {
  doc: KnowledgeDocumentItem
  systemName: string
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['knowledge', 'documents', doc.file_hash, 'chunks'],
    queryFn: () => knowledgeDocumentsApi.getDocumentChunks(doc.file_hash),
    staleTime: 60_000,
  })

  const chunks = data?.chunks ?? []

  return (
    <Modal open onClose={onClose} className="w-[860px] max-w-[calc(100vw-2rem)]">
      <div className="flex flex-col gap-4">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-text-primary truncate text-sm font-semibold">{doc.file_name}</p>
            <p className="text-text-secondary mt-0.5 text-xs">
              {systemName} · {doc.chunk_count}개 청크 · file_hash: {doc.file_hash}
            </p>
          </div>
          <NeuButton variant="ghost" size="sm" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4" />
          </NeuButton>
        </div>

        {/* 청크 목록 */}
        {isLoading ? (
          <LoadingSkeleton shape="card" count={3} />
        ) : chunks.length === 0 ? (
          <p className="text-text-secondary py-4 text-center text-sm">청크 데이터가 없습니다.</p>
        ) : (
          <div className="max-h-[520px] overflow-y-auto">
            <div className="space-y-2">
              {chunks.map((chunk) => (
                <ChunkCard key={chunk.point_id} chunk={chunk} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function ChunkCard({ chunk }: { chunk: DocumentChunk }) {
  const [expanded, setExpanded] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const metaItems: string[] = []
  if (chunk.page_no != null) metaItems.push(`p.${chunk.page_no}`)
  if (chunk.slide_no != null) metaItems.push(`slide ${chunk.slide_no}`)
  if (chunk.sheet_name) metaItems.push(chunk.sheet_name)
  if (chunk.heading) metaItems.push(chunk.heading)
  if (chunk.tags?.length) metaItems.push(chunk.tags.join(', '))

  return (
    <>
      <NeuCard className="p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-text-secondary font-mono text-[10px]">
                #{chunk.chunk_index}
              </span>
              <button
                type="button"
                onClick={() => setDetailOpen(true)}
                title="Qdrant 상세 보기"
                className={cn(
                  'rounded-sm px-1.5 py-0.5 font-mono text-[10px]',
                  'bg-bg-base text-accent',
                  'hover:bg-accent-muted focus-visible:ring-accent transition-colors focus-visible:ring-1 focus-visible:outline-none',
                )}
              >
                {chunk.point_id.slice(0, 12)}…
              </button>
              {metaItems.length > 0 && (
                <span className="text-text-disabled text-xs">{metaItems.join(' · ')}</span>
              )}
            </div>
            <p
              className={cn(
                'text-text-primary mt-1.5 text-xs leading-relaxed whitespace-pre-wrap',
                !expanded && 'line-clamp-3',
              )}
            >
              {chunk.text}
            </p>
          </div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-text-disabled hover:text-text-secondary focus-visible:ring-accent shrink-0 transition-colors focus-visible:ring-1 focus-visible:outline-none"
            aria-label={expanded ? '접기' : '펼치기'}
          >
            <ChevronRight
              className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')}
            />
          </button>
        </div>
      </NeuCard>

      {detailOpen && <ChunkDetailModal chunk={chunk} onClose={() => setDetailOpen(false)} />}
    </>
  )
}

function ChunkDetailModal({ chunk, onClose }: { chunk: DocumentChunk; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(chunk.point_id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const qdrantUrl = `/qdrant/collections/knowledge_documents/points/${chunk.point_id}`

  const metaRows: [string, string][] = [
    ['chunk_index', String(chunk.chunk_index ?? '—')],
    ['stored_at', chunk.stored_at ?? '—'],
    ['doc_type', chunk.doc_type ?? '—'],
  ]
  if (chunk.page_no != null) metaRows.push(['page_no', String(chunk.page_no)])
  if (chunk.slide_no != null) metaRows.push(['slide_no', String(chunk.slide_no)])
  if (chunk.slide_title) metaRows.push(['slide_title', chunk.slide_title])
  if (chunk.sheet_name) metaRows.push(['sheet_name', chunk.sheet_name])
  if (chunk.heading) metaRows.push(['heading', chunk.heading])
  if (chunk.tags?.length) metaRows.push(['tags', chunk.tags.join(', ')])

  return (
    <Modal open onClose={onClose} className="w-[680px] max-w-[calc(100vw-2rem)]">
      <div className="flex flex-col gap-4">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-text-secondary text-xs">point_id</p>
            <div className="flex items-center gap-2">
              <code className="bg-surface shadow-neu-pressed text-text-primary min-w-0 rounded-sm px-2 py-1 font-mono text-xs break-all">
                {chunk.point_id}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                aria-label="point_id 복사"
                className={cn(
                  'shrink-0 rounded-sm p-1 transition-colors',
                  'text-text-secondary hover:text-accent hover:bg-accent-muted',
                  'focus-visible:ring-accent focus-visible:ring-1 focus-visible:outline-none',
                )}
              >
                {copied ? (
                  <Check className="text-normal h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <a
                href={qdrantUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Qdrant REST API에서 포인트 조회"
                className={cn(
                  'shrink-0 rounded-sm p-1 transition-colors',
                  'text-text-secondary hover:text-accent hover:bg-accent-muted',
                  'focus-visible:ring-accent focus-visible:ring-1 focus-visible:outline-none',
                )}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
          <NeuButton variant="ghost" size="sm" onClick={onClose} className="shrink-0 p-1">
            <X className="h-4 w-4" />
          </NeuButton>
        </div>

        {/* 메타데이터 */}
        <div className="space-y-1">
          {metaRows.map(([k, v]) => (
            <div key={k} className="flex items-start gap-3 text-xs">
              <span className="text-text-disabled w-28 shrink-0 font-mono">{k}</span>
              <span className="text-text-primary break-all">{v}</span>
            </div>
          ))}
        </div>

        {/* 텍스트 본문 */}
        <div className="space-y-1.5">
          <p className="text-text-disabled text-xs font-medium">text</p>
          <div className="bg-surface shadow-neu-inset max-h-64 overflow-y-auto rounded-sm p-3">
            <p className="text-text-primary text-xs leading-relaxed whitespace-pre-wrap">
              {chunk.text}
            </p>
          </div>
        </div>
      </div>
    </Modal>
  )
}
