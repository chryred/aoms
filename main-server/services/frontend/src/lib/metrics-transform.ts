import type { HourlyAggregation, MetricsPayload, ChartDataPoint } from '@/types/aggregation'
import { formatKST } from '@/lib/utils'

export const COLLECTOR_METRIC_KEYS: Record<string, Record<string, string[]>> = {
  node_exporter: {
    cpu: ['cpu_avg', 'cpu_max'],
    memory: ['mem_avg', 'mem_max'],
    disk: ['disk_avg', 'disk_max'],
  },
  jmx_exporter: {
    jvm_heap: ['heap_avg', 'heap_max'],
    gc: ['gc_count', 'gc_time_avg'],
  },
  synapse_agent: {
    cpu: ['cpu_avg', 'cpu_max', 'cpu_p95', 'load1', 'load5'],
    memory: ['mem_used_pct', 'mem_p95'],
    disk: ['disk_read_mb', 'disk_write_mb', 'disk_io_ms'],
    network: ['net_rx_mb', 'net_tx_mb'],
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
