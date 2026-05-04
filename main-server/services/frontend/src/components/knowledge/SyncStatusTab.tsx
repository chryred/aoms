import { RefreshCw, CheckCircle, AlertCircle, Clock, Loader2 } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { useSyncStatus } from '@/hooks/queries/useKnowledgeQueries'
import { useTriggerSync } from '@/hooks/mutations/useKnowledgeMutations'
import { cn, formatKST, formatRelative } from '@/lib/utils'
import type { KnowledgeSyncStatus } from '@/types/knowledge'

const DEFAULT_SOURCES: KnowledgeSyncStatus[] = [
  {
    source: 'jira',
    last_sync_at: null,
    total_synced: 0,
    last_error: null,
    is_syncing: false,
    updated_at: null,
  },
  {
    source: 'confluence',
    last_sync_at: null,
    total_synced: 0,
    last_error: null,
    is_syncing: false,
    updated_at: null,
  },
]

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

  const fetched = statuses ?? []
  const allStatuses = [
    ...DEFAULT_SOURCES.filter((d) => !fetched.some((s) => s.source === d.source)),
    ...fetched,
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {allStatuses.map((s) => (
        <SyncCard
          key={s.source}
          status={s}
          onTrigger={triggerSync.mutate}
          isPending={triggerSync.isPending && triggerSync.variables === s.source}
        />
      ))}
    </div>
  )
}

function SyncCard({
  status,
  onTrigger,
  isPending,
}: {
  status: KnowledgeSyncStatus
  onTrigger: (source: 'jira' | 'confluence') => void
  isPending: boolean
}) {
  const canTrigger = status.source === 'jira' || status.source === 'confluence'
  const hasError = !!status.last_error
  const isActive = isPending || status.is_syncing

  return (
    <NeuCard severity={hasError ? 'warning' : undefined} className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-text-primary text-sm font-semibold">
          {SOURCE_LABEL[status.source] ?? status.source}
        </span>
        {status.is_syncing ? (
          <Loader2
            className="text-text-secondary h-4 w-4 shrink-0 animate-spin"
            aria-hidden="true"
          />
        ) : hasError ? (
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
          onClick={() => !isActive && onTrigger(status.source as 'jira' | 'confluence')}
          disabled={isActive}
          loading={isPending}
        >
          {!isPending && (
            <RefreshCw className={cn('h-3.5 w-3.5', status.is_syncing && 'animate-spin')} />
          )}
          {isPending ? '요청 중...' : status.is_syncing ? '동기화 중...' : '수동 동기화'}
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
