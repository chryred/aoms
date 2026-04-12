import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { MetricChart } from '@/components/charts/MetricChart'
import { SystemContactPanel } from '@/components/contacts/SystemContactPanel'
import { useSystem } from '@/hooks/queries/useSystems'
import { useHourlyAggregations, useTrendAlerts } from '@/hooks/queries/useAggregations'
import { AlertTable } from '@/components/alert/AlertTable'
import { AlertDetailPanel } from '@/components/alert/AlertDetailPanel'
import { useAlerts } from '@/hooks/queries/useAlerts'
import { getMetricKeys } from '@/lib/metrics-transform'
import { cn } from '@/lib/utils'
import type { HourlyAggregation } from '@/types/aggregation'
import type { AlertHistory } from '@/types/alert'

type TabKey = 'metrics' | 'alerts' | 'analysis' | 'contacts'
type TimeRange = '6h' | '12h' | '24h' | '48h'

const HOURS_MAP: Record<TimeRange, number> = { '6h': 6, '12h': 12, '24h': 24, '48h': 48 }

function buildTimeRange(hours: number) {
  const to = new Date()
  const from = new Date(to.getTime() - hours * 3_600_000)
  return { from_dt: from.toISOString(), to_dt: to.toISOString() }
}

export function SystemDetailPage() {
  const { systemId } = useParams<{ systemId: string }>()
  const id = Number(systemId)

  const { data: system, isLoading } = useSystem(id)
  const { data: trendAlerts = [] } = useTrendAlerts()

  const [tab, setTab] = useState<TabKey>('metrics')
  const [collectorType, setCollectorType] = useState('node_exporter')
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')
  const [selectedAlert, setSelectedAlert] = useState<AlertHistory | null>(null)

  const { from_dt, to_dt } = buildTimeRange(HOURS_MAP[timeRange])
  const { data: hourly = [] } = useHourlyAggregations({
    system_id: id,
    collector_type: collectorType,
    from_dt,
    to_dt,
  })
  const { data: alerts = [] } = useAlerts({ system_id: id })
  const { data: logAnalysisAlerts = [] } = useAlerts({ system_id: id, alert_type: 'log_analysis' })

  const systemTrends = trendAlerts.filter(
    (t) => t.system_id === id && (t.llm_severity === 'warning' || t.llm_severity === 'critical'),
  )

  if (isLoading) return <LoadingSkeleton />
  if (!system) return <div className="text-[#8B97AD]">시스템을 찾을 수 없습니다.</div>

  // collector_type별 metric_group 분리
  const groupedMetrics = hourly.reduce<Record<string, HourlyAggregation[]>>((acc, agg) => {
    const key = agg.metric_group
    if (!acc[key]) acc[key] = []
    acc[key].push(agg)
    return acc
  }, {})

  const availableCollectors = [...new Set(hourly.map((a) => a.collector_type))]
  if (!availableCollectors.includes(collectorType) && availableCollectors.length > 0) {
    // no-op — will render empty
  }

  const CHART_TITLES: Record<string, string> = {
    cpu: 'CPU 사용률',
    memory: '메모리 사용률',
    disk: '디스크 사용률',
    jvm_heap: 'JVM Heap',
    gc: 'GC',
  }

  return (
    <div>
      <nav className="mb-3 text-xs text-[#8B97AD]">
        <Link to={ROUTES.DASHBOARD} className="hover:underline">
          대시보드
        </Link>
        <span className="mx-1">›</span>
        <span className="text-[#E2E8F2]">{system.display_name}</span>
      </nav>

      <PageHeader
        title={system.display_name}
        action={
          <NeuBadge variant={system.status === 'active' ? 'normal' : 'muted'}>
            {system.status === 'active' ? '운영 중' : '비활성'}
          </NeuBadge>
        }
      />

      {/* TrendAlert 배너 */}
      {systemTrends.length > 0 && (
        <div
          className={cn(
            'mb-4 flex gap-3 rounded-sm border p-3',
            systemTrends[0].llm_severity === 'critical'
              ? 'border-[#EF4444] bg-[rgba(239,68,68,0.06)]'
              : 'border-[#F59E0B] bg-[rgba(245,158,11,0.06)]',
          )}
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#F59E0B]" />
          <div className="text-sm">
            <p className="mb-1 font-semibold text-[#E2E8F2]">장애 예측 알림</p>
            {systemTrends.map((t) => (
              <p key={t.id} className="whitespace-pre-wrap text-[#8B97AD]">
                {t.llm_prediction}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* 탭 */}
      <div className="mb-4 flex gap-1 border-b border-[#2B2F37]">
        {(['metrics', 'alerts', 'analysis', 'contacts'] as TabKey[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              tab === t
                ? 'border-b-2 border-[#00D4FF] text-[#00D4FF]'
                : 'text-[#8B97AD] hover:text-[#E2E8F2]',
            )}
          >
            {t === 'metrics'
              ? '메트릭'
              : t === 'alerts'
                ? '알림'
                : t === 'analysis'
                  ? '분석'
                  : '담당자'}
          </button>
        ))}
      </div>

      {tab === 'metrics' && (
        <div>
          {/* collector_type 선택 */}
          {availableCollectors.length > 0 && (
            <div className="mb-3 flex w-fit flex-wrap gap-1 rounded-sm bg-[#1E2127] p-1 shadow-[inset_1px_1px_3px_#111317,inset_-1px_-1px_3px_#2B2F37]">
              {availableCollectors.map((ct) => (
                <button
                  key={ct}
                  onClick={() => setCollectorType(ct)}
                  className={cn(
                    'rounded-sm px-3 py-1 text-xs font-medium transition-all',
                    collectorType === ct
                      ? 'bg-[#00D4FF] font-semibold text-[#1E2127] shadow-[2px_2px_4px_#111317]'
                      : 'text-[#8B97AD] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#E2E8F2]',
                  )}
                >
                  {ct}
                </button>
              ))}
            </div>
          )}

          {/* 시간 범위 선택 */}
          <div className="mb-4 flex w-fit gap-1 rounded-sm bg-[#1E2127] p-1 shadow-[inset_1px_1px_3px_#111317,inset_-1px_-1px_3px_#2B2F37]">
            {(['6h', '12h', '24h', '48h'] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={cn(
                  'rounded-sm px-3 py-1 text-xs font-medium transition-all',
                  timeRange === r
                    ? 'bg-[#00D4FF] font-semibold text-[#1E2127] shadow-[2px_2px_4px_#111317]'
                    : 'text-[#8B97AD] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#E2E8F2]',
                )}
              >
                최근 {r}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-4">
            {Object.entries(groupedMetrics).map(([group, aggs]) => {
              const sample = aggs[0]?.metrics_json
              const keys = getMetricKeys(collectorType, group, sample)
              const unit =
                group === 'cpu' || group === 'memory' || group === 'disk' || group === 'jvm_heap'
                  ? '%'
                  : undefined
              return (
                <MetricChart
                  key={group}
                  aggregations={aggs}
                  metricKeys={keys}
                  title={CHART_TITLES[group] ?? group}
                  unit={unit}
                  onPointClick={() => setTab('alerts')}
                />
              )
            })}
            {Object.keys(groupedMetrics).length === 0 && (
              <p className="text-sm text-[#8B97AD]">이 기간에 집계 데이터가 없습니다.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'alerts' && (
        <div>
          {alerts.length === 0 ? (
            <p className="text-sm text-[#8B97AD]">알림 이력이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {alerts.map((a) => (
                <NeuCard key={a.id} severity={a.severity as 'warning' | 'critical' | undefined}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-[#E2E8F2]">{a.title}</p>
                      {a.description && (
                        <p className="mt-0.5 text-xs text-[#8B97AD]">{a.description}</p>
                      )}
                    </div>
                    <NeuBadge
                      variant={
                        a.severity === 'critical'
                          ? 'critical'
                          : a.severity === 'warning'
                            ? 'warning'
                            : 'muted'
                      }
                    >
                      {a.severity}
                    </NeuBadge>
                  </div>
                </NeuCard>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'analysis' && (
        <>
          {logAnalysisAlerts.length === 0 ? (
            <p className="text-sm text-[#8B97AD]">이 시스템의 로그 분석 이력이 없습니다.</p>
          ) : (
            <NeuCard className="overflow-hidden p-0">
              <AlertTable alerts={logAnalysisAlerts} onSelect={setSelectedAlert} />
            </NeuCard>
          )}
          <AlertDetailPanel alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
        </>
      )}

      {tab === 'contacts' && <SystemContactPanel systemId={id} />}
    </div>
  )
}
