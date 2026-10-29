import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { ErrorCard } from '@/components/common/ErrorCard'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { TxPathTab } from '@/components/apm/detail/TxPathTab'
import { TxSqlTab } from '@/components/apm/detail/TxSqlTab'
import { TxCallTreeTab } from '@/components/apm/detail/TxCallTreeTab'
import { TxStackTab } from '@/components/apm/detail/TxStackTab'
import { TxResourceTab } from '@/components/apm/detail/TxResourceTab'
import { ROUTES } from '@/constants/routes'
import { useApmTransactionDetail } from '@/hooks/queries/useApmTransactionDetail'
import { cn, formatKST } from '@/lib/utils'

const TABS = [
  { key: 'path', label: '경로' },
  { key: 'sql', label: 'SQL' },
  { key: 'tree', label: '호출 트리' },
  { key: 'stack', label: '스택 샘플' },
  { key: 'resource', label: '리소스' },
] as const
type TabKey = (typeof TABS)[number]['key']

const NO_DETAIL = '호출 트리는 느린 기준 이상·에러 건만 보관합니다'

export function ApmTxDetailPage() {
  const { traceId, spanId } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey>('path')
  const { data, isLoading, error, refetch } = useApmTransactionDetail(traceId, spanId)

  const back = (
    <NeuButton variant="ghost" size="sm" onClick={() => navigate(ROUTES.APM_TRANSACTIONS)}>
      <ArrowLeft className="h-4 w-4" /> 목록
    </NeuButton>
  )

  if (isLoading) return <LoadingSkeleton shape="table" count={6} />
  if (error || !data) {
    return (
      <div>
        <PageHeader title="트랜잭션 상세" action={back} />
        <ErrorCard message="트랜잭션을 불러오지 못했습니다" onRetry={() => refetch()} />
      </div>
    )
  }
  const { summary, sql, detail, path } = data

  return (
    <div>
      <PageHeader
        title={summary.uri}
        description={`${summary.system_name} · ${summary.instance_role} · ${formatKST(summary.start_ts)} · ${summary.elapsed_ms.toLocaleString()}ms`}
        action={back}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <NeuBadge variant={summary.error ? 'critical' : 'normal'}>
          {summary.method} {summary.status}
        </NeuBadge>
        {summary.exc_class && <NeuBadge variant="critical">{summary.exc_class}</NeuBadge>}
        <NeuBadge>IP {summary.user_ip || '-'}</NeuBadge>
        <NeuBadge>ID {summary.user_id || '-'}</NeuBadge>
      </div>
      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'min-h-[40px] rounded-sm px-4 text-sm',
              tab === t.key ? 'shadow-neu-inset text-accent font-semibold' : 'text-text-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <NeuCard>
        {tab === 'path' && <TxPathTab path={path} current={summary} />}
        {tab === 'sql' && <TxSqlTab sql={sql} />}
        {tab === 'tree' &&
          (detail ? (
            <TxCallTreeTab nodes={detail.nodes} totalMs={summary.elapsed_ms} />
          ) : (
            <p className="text-text-secondary text-sm">{NO_DETAIL}</p>
          ))}
        {tab === 'stack' &&
          (detail ? (
            <TxStackTab stacks={detail.stacks} />
          ) : (
            <p className="text-text-secondary text-sm">{NO_DETAIL}</p>
          ))}
        {tab === 'resource' && <TxResourceTab summary={summary} />}
      </NeuCard>
    </div>
  )
}
