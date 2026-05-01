import type {
  HourlyAggregation,
  LlmSeverity,
  MetricsPayload,
  ChartDataPoint,
} from '@/types/aggregation'
import { formatKST } from '@/lib/utils'

export const COLLECTOR_METRIC_KEYS: Record<string, Record<string, string[]>> = {
  synapse_agent: {
    cpu: ['cpu_avg', 'cpu_max', 'cpu_p95', 'load1', 'load5'],
    memory: ['mem_used_pct', 'mem_p95'],
    disk: ['disk_read_mb', 'disk_write_mb', 'disk_io_ms'],
    network: ['net_rx_mb', 'net_tx_mb', 'net_max_mbps'],
    log: ['log_errors', 'log_errors_err'],
    web: ['req_total', 'req_slow', 'resp_avg_ms'],
  },
  db_exporter: {
    db_connections: ['conn_active_pct', 'conn_max'],
    db_query: ['tps', 'slow_queries'],
    db_cache: ['cache_hit_rate'],
    db_replication: ['repl_lag_sec'],
  },
}

export function getMetricKeys(
  collectorType: string,
  metricGroup: string,
  sample?: string,
): string[] {
  const keys = COLLECTOR_METRIC_KEYS[collectorType]?.[metricGroup]
  if (keys) return keys
  if (sample) {
    try {
      return Object.keys(JSON.parse(sample) as Record<string, unknown>)
    } catch {
      return []
    }
  }
  return []
}

const SEVERITY_RANK: Record<string, number> = { critical: 2, warning: 1, normal: 0 }

/**
 * 여러 시스템의 hourly 데이터를 hour_bucket 기준 평균 집계.
 * 시스템 간 metric 값을 평균하고, severity는 worst-wins.
 */
export function aggregateCrossSystems(
  aggregations: HourlyAggregation[],
  collectorType: string,
  metricGroup: string,
): HourlyAggregation[] {
  const filtered = aggregations.filter(
    (a) => a.collector_type === collectorType && a.metric_group === metricGroup,
  )
  if (filtered.length === 0) return []

  const groups = new Map<
    string,
    { records: HourlyAggregation[]; metrics: Record<string, number[]> }
  >()

  for (const agg of filtered) {
    let group = groups.get(agg.hour_bucket)
    if (!group) {
      group = { records: [], metrics: {} }
      groups.set(agg.hour_bucket, group)
    }
    group.records.push(agg)
    const parsed = JSON.parse(agg.metrics_json) as Record<string, number>
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && !Number.isNaN(v)) {
        ;(group.metrics[k] ??= []).push(v)
      }
    }
  }

  const result: HourlyAggregation[] = []
  for (const [bucket, group] of groups) {
    const avgMetrics: Record<string, number> = {}
    for (const [k, vals] of Object.entries(group.metrics)) {
      avgMetrics[k] = vals.reduce((a, b) => a + b, 0) / vals.length
    }

    let worstSeverity: LlmSeverity | null = null
    for (const r of group.records) {
      if (
        r.llm_severity &&
        (SEVERITY_RANK[r.llm_severity] ?? 0) > (SEVERITY_RANK[worstSeverity ?? ''] ?? -1)
      ) {
        worstSeverity = r.llm_severity
      }
    }

    result.push({
      id: 0,
      system_id: 0,
      hour_bucket: bucket,
      collector_type: collectorType,
      metric_group: metricGroup,
      metrics_json: JSON.stringify(avgMetrics),
      llm_summary: null,
      llm_severity: worstSeverity,
      llm_trend: null,
      llm_prediction: null,
      llm_model_used: null,
      qdrant_point_id: null,
      created_at: bucket,
    })
  }

  return result.sort((a, b) => a.hour_bucket.localeCompare(b.hour_bucket))
}

/**
 * metrics_json에서 `{metricBase}__{instance_role}` 패턴 키를 추출하여
 * 인스턴스별 타임시리즈로 변환 (팝업 차트 인스턴스 선택용).
 *
 * 예: metricBase="cpu_max_by_inst" → "cpu_max_by_inst__was1", "cpu_max_by_inst__db2" 키 인식
 */
export function extractInstanceSeries(
  rows: HourlyAggregation[],
  metricBase: string,
): { instance_role: string; values: { ts: string; value: number | null }[] }[] {
  const byInstance = new Map<string, { ts: string; value: number | null }[]>()
  for (const row of rows) {
    let parsed: Record<string, number | null>
    try {
      parsed = JSON.parse(row.metrics_json) as Record<string, number | null>
    } catch {
      continue
    }
    for (const [key, val] of Object.entries(parsed)) {
      if (!key.startsWith(metricBase + '__')) continue
      const role = key.slice(metricBase.length + 2)
      if (!byInstance.has(role)) byInstance.set(role, [])
      byInstance.get(role)!.push({
        ts: formatKST(row.hour_bucket, 'HH:mm'),
        value: typeof val === 'number' ? val : null,
      })
    }
  }
  return [...byInstance.entries()].map(([instance_role, values]) => ({ instance_role, values }))
}

/**
 * 주어진 metrics_json 샘플에서 `{metricBase}__` 패턴을 가진 instance_role 목록 추출.
 */
export function getAvailableInstances(rows: HourlyAggregation[], metricBase: string): string[] {
  const roles = new Set<string>()
  for (const row of rows) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(row.metrics_json) as Record<string, unknown>
    } catch {
      continue
    }
    for (const key of Object.keys(parsed)) {
      if (key.startsWith(metricBase + '__')) {
        roles.add(key.slice(metricBase.length + 2))
      }
    }
  }
  return [...roles].sort()
}

export function transformToChartData(
  aggregations: HourlyAggregation[],
  metricKeys: string[],
): ChartDataPoint[] {
  return aggregations.map((agg) => {
    const parsed = JSON.parse(agg.metrics_json) as MetricsPayload
    const point: ChartDataPoint = {
      timestamp: formatKST(agg.hour_bucket, 'HH:mm'),
      llm_severity: agg.llm_severity,
    }
    for (const key of metricKeys) {
      if (key in (parsed as Record<string, unknown>)) {
        point[key] = (parsed as Record<string, number>)[key]
      }
    }
    return point
  })
}
