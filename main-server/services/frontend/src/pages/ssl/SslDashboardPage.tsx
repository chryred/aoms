import { useNavigate } from 'react-router-dom'
import { ShieldCheck, AlertTriangle, Clock, Server, RefreshCw, Lock } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { useSslCertStatus } from '@/hooks/queries/useSslCerts'
import { ROUTES } from '@/constants/routes'
import { formatKST, cn } from '@/lib/utils'
import type { SslCertStatus } from '@/types/ssl'

function DaysLeftBadge({ days }: { days: number | null }) {
  if (days === null) {
    return (
      <span className="bg-muted-bg text-text-secondary rounded-sm px-2 py-0.5 text-xs">
        미확인
      </span>
    )
  }
  const cls =
    days < 7
      ? 'bg-critical/10 text-critical'
      : days < 30
        ? 'bg-warning/10 text-warning'
        : 'bg-normal/10 text-normal'
  return <span className={cn('rounded-sm px-2 py-0.5 text-xs font-medium', cls)}>D-{days}</span>
}

function CertCard({
  item,
  onNavigateToServers,
}: {
  item: SslCertStatus
  onNavigateToServers: () => void
}) {
  const { server, snapshot } = item
  const days = snapshot?.days_left ?? null
  const isValid = snapshot?.is_valid ?? null

  const borderCls =
    isValid === false
      ? 'border-critical/40'
      : days !== null && days < 7
        ? 'border-critical/40'
        : days !== null && days < 30
          ? 'border-warning/40'
          : 'border-border'

  return (
    <div className={cn('bg-surface flex flex-col gap-2 rounded-sm border p-4', borderCls)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-text-primary truncate font-medium">{server.host}</p>
          <p className="text-text-secondary text-xs">
            {server.system_name} · {server.web_type}
          </p>
        </div>
        <DaysLeftBadge days={days} />
      </div>

      <div className="text-text-secondary flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          <span className="text-text-disabled">만료일</span> {snapshot?.expiry_date ?? '—'}
        </span>
        <span>
          <span className="text-text-disabled">영역</span>{' '}
          {server.network_zone === 'dmz' ? 'DMZ' : '내부망'}
        </span>
        <span>
          <span className="text-text-disabled">타입</span>{' '}
          {server.cert_type === 'wildcard' ? '와일드카드' : (server.domain ?? '개별')}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-xs">
        <div className="flex items-center gap-1">
          {isValid === false ? (
            <span className="text-critical flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              SSL 응답 실패
              <button
                type="button"
                onClick={onNavigateToServers}
                aria-label="서버 관리 페이지로 이동"
                className="text-text-secondary hover:text-text-primary ml-1 underline underline-offset-2 transition-colors focus-visible:rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              >
                서버 관리 →
              </button>
            </span>
          ) : isValid === true ? (
            <span className="text-normal flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" /> 정상
            </span>
          ) : (
            <span className="text-text-disabled flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden="true" /> 폴링 대기
            </span>
          )}
          {snapshot && (
            <span className="text-text-disabled ml-auto">
              점검 {formatKST(snapshot.checked_at, 'datetime')}
            </span>
          )}
        </div>
        {isValid === false && (
          <p className="text-text-disabled">포트 443 응답 없음 또는 인증서 미설치</p>
        )}
      </div>
    </div>
  )
}

export function SslDashboardPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useSslCertStatus()

  const expiring = data?.filter((d) => (d.snapshot?.days_left ?? 999) < 7) ?? []
  const failed = data?.filter((d) => d.snapshot?.is_valid === false) ?? []
  const criticalIds = new Set([
    ...expiring.map((d) => d.server.id),
    ...failed.map((d) => d.server.id),
  ])
  const criticalCount = criticalIds.size

  const warning =
    data?.filter((d) => {
      const d_ = d.snapshot?.days_left
      return d_ !== undefined && d_ !== null && d_ >= 7 && d_ < 30 && d.snapshot?.is_valid !== false
    }) ?? []

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="SSL 인증서 현황"
        description="인증서 만료 D-day 모니터링"
        action={
          <div className="flex gap-2">
            <NeuButton
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="새로고침"
              aria-busy={isFetching}
            >
              <RefreshCw
                className={cn('h-4 w-4', isFetching && 'animate-spin')}
                aria-hidden="true"
              />
            </NeuButton>
            <NeuButton size="sm" onClick={() => navigate(ROUTES.SSL_SERVERS)}>
              <Server className="h-4 w-4" aria-hidden="true" />
              서버 관리
            </NeuButton>
            <NeuButton size="sm" variant="ghost" onClick={() => navigate(ROUTES.SSL_DEPLOYMENTS)}>
              배포 이력
            </NeuButton>
            <NeuButton
              size="sm"
              variant="ghost"
              onClick={() => navigate(ROUTES.SSL_CA_GUIDE)}
              aria-label="Root CA 가이드"
            >
              <Lock className="h-4 w-4" aria-hidden="true" />
            </NeuButton>
          </div>
        }
      />

      {/* 요약 통계 */}
      {data && (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4"
          aria-live="polite"
          aria-atomic="true"
          aria-label="인증서 현황 요약"
        >
          <div className="bg-surface border-border rounded-sm border p-4">
            <p className="text-text-disabled text-xs">전체 서버</p>
            <p className="text-text-primary text-2xl font-semibold">{data.length}</p>
            <p className="text-text-disabled mt-0.5 text-xs">등록된 서버 수</p>
          </div>
          <div
            className={cn(
              'bg-surface rounded-sm border p-4',
              criticalCount > 0 ? 'border-critical/40' : 'border-border',
            )}
          >
            <p className="text-text-disabled text-xs">위험</p>
            <p
              className={cn(
                'text-2xl font-semibold',
                criticalCount > 0 ? 'text-critical' : 'text-text-primary',
              )}
            >
              {criticalCount}
            </p>
            <p className="text-text-disabled mt-0.5 text-xs">만료 임박 · 응답 실패</p>
          </div>
          <div
            className={cn(
              'bg-surface rounded-sm border p-4',
              warning.length > 0 ? 'border-warning/40' : 'border-border',
            )}
          >
            <p className="text-text-disabled text-xs">주의</p>
            <p
              className={cn(
                'text-2xl font-semibold',
                warning.length > 0 ? 'text-warning' : 'text-text-primary',
              )}
            >
              {warning.length}
            </p>
            <p className="text-text-disabled mt-0.5 text-xs">30일 이내 만료</p>
          </div>
        </div>
      )}

      {/* 모두 정상 상태 */}
      {data && data.length > 0 && criticalCount === 0 && warning.length === 0 && (
        <div className="text-normal flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>모든 인증서가 정상입니다</span>
        </div>
      )}

      {isLoading && <LoadingSkeleton count={6} />}
      {isError && <ErrorCard message="인증서 현황을 불러오지 못했습니다." onRetry={refetch} />}

      {data && data.length === 0 && (
        <div className="py-16 text-center">
          <ShieldCheck className="text-text-disabled mx-auto mb-3 h-10 w-10" />
          <p className="text-text-secondary mb-4">등록된 서버가 없습니다</p>
          <NeuButton size="sm" onClick={() => navigate(ROUTES.SSL_SERVERS)}>
            서버 등록
          </NeuButton>
        </div>
      )}

      {/* 서버 목록 */}
      {data && data.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <h2 className="text-text-disabled text-xs font-medium tracking-wider">서버 목록</h2>
            <div className="border-border flex-1 border-t" />
            {dataUpdatedAt > 0 && (
              <span className="text-text-disabled text-xs">
                {formatKST(new Date(dataUpdatedAt).toISOString(), 'datetime')} 기준
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((item) => (
              <CertCard
                key={item.server.id}
                item={item}
                onNavigateToServers={() => navigate(ROUTES.SSL_SERVERS)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
