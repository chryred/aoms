import { describe, it, expect } from 'vitest'
import { COLLECTOR_METRIC_KEYS, getMetricKeys, transformToChartData } from '@/lib/metrics-transform'
import type { HourlyAggregation } from '@/types/aggregation'

describe('COLLECTOR_METRIC_KEYS', () => {
  it('synapse_agent 키 존재', () => {
    expect(COLLECTOR_METRIC_KEYS.synapse_agent.cpu).toEqual([
      'cpu_avg',
      'cpu_max',
      'cpu_p95',
      'load1',
      'load5',
    ])
    expect(COLLECTOR_METRIC_KEYS.synapse_agent.memory).toEqual(['mem_used_pct', 'mem_p95'])
    expect(COLLECTOR_METRIC_KEYS.synapse_agent.disk).toEqual([
      'disk_read_mb',
      'disk_write_mb',
      'disk_io_ms',
    ])
  })

  it('db_exporter 키 존재', () => {
    expect(COLLECTOR_METRIC_KEYS.db_exporter.db_connections).toEqual([
      'conn_active_pct',
      'conn_max',
    ])
    expect(COLLECTOR_METRIC_KEYS.db_exporter.db_query).toEqual(['tps', 'slow_queries'])
  })
})

describe('getMetricKeys', () => {
  it('정의된 collectorType + metricGroup 반환', () => {
    const keys = getMetricKeys('synapse_agent', 'cpu')
    expect(keys).toEqual(['cpu_avg', 'cpu_max', 'cpu_p95', 'load1', 'load5'])
  })

  it('정의되지 않은 그룹 — sample JSON 파싱', () => {
    const sample = JSON.stringify({ custom_key: 1, another_key: 2 })
    const keys = getMetricKeys('unknown_type', 'custom_group', sample)
    expect(keys).toEqual(['custom_key', 'another_key'])
  })

  it('정의되지 않은 그룹, sample 없음 → 빈 배열', () => {
    const keys = getMetricKeys('unknown_type', 'custom_group')
    expect(keys).toEqual([])
  })

  it('sample 파싱 실패 → 빈 배열', () => {
    const keys = getMetricKeys('unknown_type', 'custom_group', 'invalid-json')
    expect(keys).toEqual([])
  })
})

describe('transformToChartData', () => {
  const makeAgg = (
    hour: string,
    metrics: Record<string, number>,
    severity: 'normal' | 'warning' | 'critical' | null = 'normal',
  ): HourlyAggregation =>
    ({
      id: 1,
      system_id: 1,
      collector_type: 'synapse_agent',
      metric_group: 'cpu',
      hour_bucket: hour,
      metrics_json: JSON.stringify(metrics),
      llm_severity: severity,
      llm_analysis: null,
      qdrant_point_id: null,
      created_at: hour,
    }) as HourlyAggregation

  it('빈 배열 → 빈 배열', () => {
    expect(transformToChartData([], ['cpu_avg'])).toEqual([])
  })

  it('metrics_json에서 지정된 키만 포함', () => {
    const agg = makeAgg('2024-01-01T10:00:00Z', { cpu_avg: 55.0, cpu_max: 80.0, mem_avg: 70.0 })
    const result = transformToChartData([agg], ['cpu_avg'])
    expect(result[0]).toHaveProperty('cpu_avg', 55.0)
    expect(result[0]).not.toHaveProperty('mem_avg')
    expect(result[0]).not.toHaveProperty('cpu_max')
  })

  it('timestamp KST 변환', () => {
    const agg = makeAgg('2024-01-01T01:00:00Z', { cpu_avg: 50.0 })
    const result = transformToChartData([agg], ['cpu_avg'])
    expect(result[0].timestamp).toBe('10:00')
  })

  it('llm_severity 포함', () => {
    const agg = makeAgg('2024-01-01T10:00:00Z', { cpu_avg: 50.0 }, 'warning')
    const result = transformToChartData([agg], ['cpu_avg'])
    expect(result[0].llm_severity).toBe('warning')
  })

  it('존재하지 않는 키는 포함 안 됨', () => {
    const agg = makeAgg('2024-01-01T10:00:00Z', { cpu_avg: 50.0 })
    const result = transformToChartData([agg], ['cpu_avg', 'nonexistent_key'])
    expect(result[0]).not.toHaveProperty('nonexistent_key')
  })
})
