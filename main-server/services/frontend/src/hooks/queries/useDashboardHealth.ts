import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/ky-client'

export interface SystemHealthData {
  system_id: string
  display_name: string
  system_name: string
  status: 'normal' | 'warning' | 'critical'
  reason: string
  proactive_count: number // 예방 패턴 감지 건수
  has_otel?: boolean
}

export interface DashboardSummary {
  total_systems: number
  critical_systems: number
  warning_systems: number
  normal_systems: number
  proactive_systems: number // 예방 패턴 감지된 시스템 수
  total_metric_alerts: number
  total_log_critical: number
  total_log_warning: number
  active_collectors: number
  last_updated: string
}

export interface DashboardHealthResponse {
  summary: DashboardSummary
  systems: SystemHealthData[]
}

export function useDashboardHealth() {
  return useQuery<DashboardHealthResponse>({
    queryKey: ['dashboardHealth'],
    queryFn: () => adminApi.get('api/v1/dashboard/system-health').json<DashboardHealthResponse>(),
    refetchInterval: 60000, // 60초마다 자동 새로고침
    staleTime: 30000, // 30초 동안 fresh 유지
  })
}

export interface MetricAlert {
  id: string
  alert_type: 'metric' | 'log_analysis'
  alertname: string
  title?: string
  severity: string
  value: string | null
  created_at: string
}

export interface LogAnalysisIncident {
  id: string
  log_message: string
  analysis_result: string
  severity: string
  anomaly_type: string
  created_at: string
}

export interface LogAnalysisSummary {
  latest_count: number
  critical_count: number
  warning_count: number
  incidents: LogAnalysisIncident[]
}

export interface SystemContact {
  id: string
  name: string
  teams_upn: string
  phone: string
  role: string
}

export interface ProactiveAlert {
  id: string
  collector_type: string
  metric_group: string
  hour_bucket: string
  llm_severity: 'warning' | 'critical'
  llm_trend: string | null
  llm_prediction: string
}

export interface SystemDetailResponse {
  system_id: string
  display_name: string
  system_name: string
  metric_alerts: MetricAlert[]
  log_analysis: LogAnalysisSummary
  proactive_alerts: ProactiveAlert[] // 예방적 패턴 감지
  contacts: SystemContact[]
  last_updated: string
}

export function useSystemDetailHealth(systemId: string | undefined) {
  return useQuery<SystemDetailResponse>({
    queryKey: ['systemDetailHealth', systemId],
    queryFn: () =>
      adminApi.get(`api/v1/dashboard/systems/${systemId}/detailed`).json<SystemDetailResponse>(),
    enabled: !!systemId,
    refetchInterval: 30000, // 30초마다 새로고침
    staleTime: 15000,
  })
}

// WebSocket 실시간 알림 업데이트 hook (향후)
export function useDashboardRealtimeAlerts() {
  useQueryClient()

  // WebSocket connection setup (Phase 8)
  // const [wsConnected, setWsConnected] = useState(false)
  // useEffect(() => {
  //   const ws = new WebSocket(`wss://${API_HOST}/ws/dashboard`)
  //   ws.onmessage = (event) => {
  //     const data = JSON.parse(event.data)
  //     if (data.type === 'alert_fired' || data.type === 'alert_resolved') {
  //       queryClient.invalidateQueries({ queryKey: ['dashboardHealth'] })
  //     }
  //   }
  //   return () => ws.close()
  // }, [queryClient])

  return {
    wsConnected: false, // placeholder
  }
}
