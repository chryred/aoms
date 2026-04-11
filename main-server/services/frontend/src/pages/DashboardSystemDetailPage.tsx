import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertCircle, AlertTriangle, CheckCircle, Clock, ShieldAlert, TrendingUp } from 'lucide-react'
import { useSystemDetailHealth } from '@/hooks/queries/useDashboardHealth'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { formatKST, cn } from '@/lib/utils'

export function DashboardSystemDetailPage() {
  const { systemId } = useParams<{ systemId: string }>()
  const navigate = useNavigate()

  const { data: detail, isLoading, error, refetch } = useSystemDetailHealth(systemId)

  if (!systemId) {
    return (
      <div className="text-center py-8">
        <p className="text-[#8B97AD]">시스템을 선택해주세요</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton shape="card" count={1} />
        <LoadingSkeleton shape="card" count={3} />
      </div>
    )
  }

  if (error || !detail) {
    return <ErrorCard onRetry={() => refetch()} />
  }

  const severityConfig = {
    critical: {
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
      icon: AlertCircle,
    },
    warning: {
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500/10',
      icon: AlertTriangle,
    },
    info: {
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      icon: CheckCircle,
    },
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="space-y-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-[#8B97AD] hover:text-[#E2E8F2] transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          돌아가기
        </button>
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-[#E2E8F2] break-words leading-tight sm:text-2xl">
            {detail.display_name}
          </h1>
          <p className="text-xs sm:text-sm text-[#8B97AD] font-mono">
            <span className="inline-block px-1.5 py-0.5 rounded bg-[#2A3447]/40 mr-2">
              {detail.system_type.toUpperCase()}
            </span>
            <span className="break-all">{detail.system_name}</span>
          </p>
        </div>
      </div>

      {/* 1️⃣ 활성 메트릭 알림 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#E2E8F2]">
            활성 메트릭 알림
          </h2>
          {detail.metric_alerts.length > 0 && (
            <NeuBadge variant="danger">{detail.metric_alerts.length}개</NeuBadge>
          )}
        </div>

        {detail.metric_alerts.length === 0 ? (
          <NeuCard className="py-8 text-center text-[#8B97AD]">
            활성 메트릭 알림이 없습니다
          </NeuCard>
        ) : (
          <div className="grid gap-3">
            {detail.metric_alerts.map((alert) => (
              <div
                key={alert.id}
                className="transition-all duration-150 hover:shadow-lg"
              >
                <NeuCard
                  className={cn(
                    'border-l-4 transition-all duration-150',
                    alert.severity === 'critical'
                      ? 'border-l-red-500/50'
                      : 'border-l-yellow-500/50'
                  )}
                >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-[#E2E8F2] break-words line-clamp-2 leading-tight">
                      {alert.alertname}
                    </h3>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-[#8B97AD]">
                      <Clock className="h-3 w-3 flex-shrink-0" />
                      <span>{formatKST(alert.created_at, 'HH:mm:ss')}</span>
                    </div>
                  </div>
                  <div className="flex sm:flex-col sm:items-end items-center gap-2">
                    <NeuBadge
                      variant={alert.severity === 'critical' ? 'danger' : 'warning'}
                    >
                      {alert.severity.toUpperCase()}
                    </NeuBadge>
                    {alert.value && (
                      <p className="text-sm font-mono text-[#A8B5C3]">
                        {alert.value}
                      </p>
                    )}
                  </div>
                </div>
                </NeuCard>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2️⃣ 최근 로그분석 결과 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#E2E8F2]">
            로그분석 결과 (최근 1시간)
          </h2>
          {detail.log_analysis.latest_count > 0 && (
            <NeuBadge variant="info">{detail.log_analysis.latest_count}건</NeuBadge>
          )}
        </div>

        {/* 요약 통계 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="transition-all duration-150 hover:shadow-lg">
            <NeuCard className="text-center py-4 border-l-4 border-red-500/30 transition-all duration-150">
              <p className="text-sm text-[#8B97AD] mb-1">Critical</p>
              <p className="text-2xl font-bold text-red-500">
                {detail.log_analysis.critical_count}
              </p>
            </NeuCard>
          </div>
          <div className="transition-all duration-150 hover:shadow-lg">
            <NeuCard className="text-center py-4 border-l-4 border-yellow-500/30 transition-all duration-150">
              <p className="text-sm text-[#8B97AD] mb-1">Warning</p>
              <p className="text-2xl font-bold text-yellow-500">
                {detail.log_analysis.warning_count}
              </p>
            </NeuCard>
          </div>
          <div className="transition-all duration-150 hover:shadow-lg">
            <NeuCard className="text-center py-4 border-l-4 border-blue-500/30 transition-all duration-150">
              <p className="text-sm text-[#8B97AD] mb-1">전체</p>
              <p className="text-2xl font-bold text-blue-500">
                {detail.log_analysis.latest_count}
              </p>
            </NeuCard>
          </div>
        </div>

        {/* 상세 이상 목록 */}
        {detail.log_analysis.incidents.length === 0 ? (
          <NeuCard className="py-8 text-center text-[#8B97AD]">
            최근 로그 이상이 없습니다
          </NeuCard>
        ) : (
          <div className="grid gap-3">
            {detail.log_analysis.incidents.map((incident) => {
              const config = severityConfig[incident.severity as keyof typeof severityConfig]
              const Icon = config.icon
              return (
                <div
                  key={incident.id}
                  className="transition-all duration-150 hover:shadow-lg"
                >
                  <NeuCard
                    className={cn(
                      'border-l-4 transition-all duration-150',
                      incident.severity === 'critical'
                        ? 'border-l-red-500/50'
                        : incident.severity === 'warning'
                          ? 'border-l-yellow-500/50'
                          : 'border-l-blue-500/50'
                    )}
                  >
                  <div className="space-y-3">
                    {/* 헤더 */}
                    <div className="flex items-start gap-2">
                      <Icon className={cn('h-4 w-4 mt-1 flex-shrink-0', config.color)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <p className="text-xs font-semibold text-[#8B97AD] uppercase">
                            {incident.anomaly_type === 'duplicate' && '🔄 반복 이상'}
                            {incident.anomaly_type === 'recurring' && '⚠️ 반복 이상'}
                            {incident.anomaly_type === 'related' && '🔗 유사 이상'}
                            {incident.anomaly_type === 'new' && '⚡ 신규 이상'}
                          </p>
                          <NeuBadge variant={incident.severity === 'critical' ? 'danger' : 'warning'}>
                            {incident.severity.toUpperCase()}
                          </NeuBadge>
                        </div>
                        <p className="text-sm text-[#E2E8F2] font-semibold line-clamp-2 break-words leading-snug">
                          {incident.log_message}
                        </p>
                      </div>
                    </div>

                    {/* LLM 분석 결과 */}
                    <div className="bg-[#2A3447]/30 rounded-md p-3 border border-[#2A3447]/50">
                      <p className="text-xs text-[#8B97AD] font-semibold mb-2 flex items-center gap-1">
                        <span>💡</span>
                        분석 결과
                      </p>
                      <p className="text-sm text-[#A8B5C3] line-clamp-4 leading-relaxed break-words">
                        {incident.analysis_result}
                      </p>
                    </div>

                    {/* 시간 */}
                    <div className="text-xs text-[#8B97AD]">
                      {formatKST(incident.created_at, 'YYYY-MM-DD HH:mm:ss')}
                    </div>
                  </div>
                  </NeuCard>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 3️⃣ 예방적 패턴 감지 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#E2E8F2] flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-purple-400" />
            예방적 패턴 감지
          </h2>
          {detail.proactive_alerts.length > 0 && (
            <NeuBadge variant="info">{detail.proactive_alerts.length}건</NeuBadge>
          )}
        </div>

        {detail.proactive_alerts.length === 0 ? (
          <NeuCard className="py-6 text-center text-[#8B97AD]">
            <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm">감지된 예방 패턴이 없습니다</p>
          </NeuCard>
        ) : (
          <div className="grid gap-3">
            {detail.proactive_alerts.map((alert) => (
              <div
                key={alert.id}
                className="transition-all duration-150 hover:shadow-lg"
              >
                <NeuCard
                  className={cn(
                    'border-l-4 transition-all duration-150',
                    alert.llm_severity === 'critical'
                      ? 'border-l-red-500/40'
                      : 'border-l-purple-500/40'
                  )}
                >
                <div className="space-y-3">
                  {/* 헤더 */}
                  <div className="flex items-start justify-between gap-3 sm:gap-4">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <TrendingUp className="h-4 w-4 text-purple-400 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#E2E8F2] break-words line-clamp-2">
                          <span className="font-mono text-xs bg-[#2A3447]/40 px-1.5 py-0.5 rounded inline-block mr-1">
                            {alert.collector_type}
                          </span>
                          {alert.metric_group}
                        </p>
                        <p className="text-xs text-[#8B97AD] mt-1">
                          {formatKST(alert.hour_bucket, 'MM-DD HH:mm')} 집계
                        </p>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <NeuBadge
                        variant={alert.llm_severity === 'critical' ? 'danger' : 'warning'}
                      >
                        {alert.llm_severity?.toUpperCase()}
                      </NeuBadge>
                    </div>
                  </div>

                  {/* 트렌드 */}
                  {alert.llm_trend && (
                    <div className="bg-[#2A3447]/30 rounded-md p-3 border border-[#2A3447]/50">
                      <p className="text-xs text-[#8B97AD] font-semibold mb-2 flex items-center gap-1">
                        <span>📈</span>
                        트렌드
                      </p>
                      <p className="text-sm text-[#A8B5C3] leading-relaxed break-words">{alert.llm_trend}</p>
                    </div>
                  )}

                  {/* 예측 */}
                  <div className="bg-purple-500/5 border border-purple-500/25 rounded-md p-3">
                    <p className="text-xs text-purple-400 font-semibold mb-2 flex items-center gap-1">
                      <span>⚡</span>
                      예측
                    </p>
                    <p className="text-sm text-[#E2E8F2] leading-relaxed break-words max-h-32 overflow-y-auto">
                      {alert.llm_prediction}
                    </p>
                  </div>
                </div>
                </NeuCard>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4️⃣ 담당자 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#E2E8F2]">담당자</h2>

        {detail.contacts.length === 0 ? (
          <NeuCard className="py-8 text-center text-[#8B97AD]">
            등록된 담당자가 없습니다
          </NeuCard>
        ) : (
          <div className="grid gap-3">
            {detail.contacts.map((contact) => (
              <div
                key={contact.id}
                className="transition-all duration-150 hover:shadow-lg"
              >
                <NeuCard className="transition-all duration-150">
                  <div className="flex items-start justify-between gap-3 sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-[#E2E8F2] break-words">
                        {contact.name}
                      </h3>
                      <p className="text-xs sm:text-sm text-[#8B97AD] font-mono mt-1 break-all">
                        {contact.teams_upn}
                      </p>
                      {contact.phone && (
                        <p className="text-xs sm:text-sm text-[#8B97AD] mt-1">
                          {contact.phone}
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0">
                      <NeuBadge variant="info">{contact.role}</NeuBadge>
                    </div>
                  </div>
                </NeuCard>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 마지막 업데이트 */}
      <div className="text-center text-xs text-[#8B97AD] py-4">
        마지막 업데이트: {formatKST(detail.last_updated, 'YYYY-MM-DD HH:mm:ss')}
      </div>
    </div>
  )
}
