import { useCallback, useRef, useState } from 'react'
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, X } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { useSystems } from '@/hooks/queries/useSystems'
import { useUploadDocument } from '@/hooks/mutations/useKnowledgeMutations'
import { useUploadStatus } from '@/hooks/queries/useKnowledgeQueries'
import { cn } from '@/lib/utils'
import type { UploadJob } from '@/types/knowledge'

interface UploadEntry {
  localId: string
  file: File
  jobId: string | null
  status: UploadJob['status'] | 'uploading'
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
    [selectedSystemId, tags, uploadMutation],
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
        onDragLeave={() => setIsDragging(false)}
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
          <p className="text-text-secondary mt-1 text-xs">PDF, TXT, MD, DOCX 지원</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.docx"
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
  // 서버 측 상태 폴링 (jobId가 있고 완료 전인 경우)
  const polling = !!entry.jobId && entry.status !== 'done' && entry.status !== 'error'
  const { data: jobStatus } = useUploadStatus(polling ? (entry.jobId ?? null) : null)

  const resolvedStatus = jobStatus?.status ?? entry.status
  const resolvedPointCount = jobStatus?.point_count ?? entry.pointCount
  const resolvedError = jobStatus?.error ?? entry.error

  return (
    <NeuCard className="flex items-center gap-3 p-3">
      <FileText className="text-text-secondary h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-text-primary truncate text-sm font-medium">{entry.file.name}</p>
        <p className="text-text-secondary text-xs">
          {Math.round(entry.file.size / 1024)}KB
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
