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
