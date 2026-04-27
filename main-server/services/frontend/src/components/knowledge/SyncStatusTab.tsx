import { RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { useSyncStatus } from '@/hooks/queries/useKnowledgeQueries'
import { useTriggerSync } from '@/hooks/mutations/useKnowledgeMutations'
import { formatKST, formatRelative } from '@/lib/utils'
import type { KnowledgeSyncStatus } from '@/types/knowledge'

const SOURCE_LABEL: Record<string, string> = {
  jira: 'Jira',
  confluence: 'Confluence',
  documents: '문서 업로드',
}

export function SyncStatusTab() {
  const { data: statuses, isLoading, isError, refetch } = useSyncStatus()
  const triggerSync = useTriggerSync()

  if (isLoading) return <LoadingSkeleton shape="card" count={3} />
  if (isError) return <ErrorCard onRetry={refetch} />

  const allStatuses = statuses ?? []

  return (
    <div className="space-y-4">
      {allStatuses.length === 0 && (
        <p className="text-text-secondary py-8 text-center text-sm">동기화 소스가 없습니다.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {allStatuses.map((s) => (
          <SyncCard key={s.source} status={s} onTrigger={triggerSync.mutate} />
        ))}
      </div>
    </div>
  )
}

function SyncCard({
  status,
  onTrigger,
}: {
  status: KnowledgeSyncStatus
  onTrigger: (source: 'jira' | 'confluence') => void
}) {
  const canTrigger = status.source === 'jira' || status.source === 'confluence'
  const hasError = !!status.last_error

  return (
    <NeuCard severity={hasError ? 'warning' : undefined} className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-text-primary text-sm font-semibold">
          {SOURCE_LABEL[status.source] ?? status.source}
        </span>
        {hasError ? (
          <AlertCircle className="text-warning h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <CheckCircle className="text-normal h-4 w-4 shrink-0" aria-hidden="true" />
        )}
      </div>

      <div className="space-y-1.5">
        <InfoRow
          icon={<Clock className="h-3.5 w-3.5" />}
          label="마지막 동기화"
          value={status.last_sync_at ? formatRelative(status.last_sync_at) : '미실행'}
          sub={status.last_sync_at ? formatKST(status.last_sync_at, 'datetime') : undefined}
        />
        <InfoRow
          icon={<CheckCircle className="h-3.5 w-3.5" />}
          label="동기화 항목"
          value={`${status.total_synced.toLocaleString()}건`}
        />
        {hasError && (
          <div className="bg-warning-card-bg border-warning-border rounded-sm border px-2 py-1.5">
            <p className="text-warning line-clamp-2 text-xs">{status.last_error}</p>
          </div>
        )}
      </div>

      {canTrigger && (
        <NeuButton
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={() => onTrigger(status.source as 'jira' | 'confluence')}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          수동 동기화
        </NeuButton>
      )}
    </NeuCard>
  )
}

function InfoRow({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-text-secondary mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <span className="text-text-secondary text-xs">{label}: </span>
        <span className="text-text-primary text-xs font-medium">{value}</span>
        {sub && <p className="text-text-disabled text-[11px]">{sub}</p>}
      </div>
    </div>
  )
}
