// SYNC: main-server/services/admin-api/services/metric_types.py
// 변경 시 양쪽 파일을 함께 수정할 것.

export const METRIC_TYPES = [
  'cpu',
  'memory',
  'disk_io',
  'network_rx',
  'network_tx',
  'http_latency',
  'log_error_rate',
] as const

export type MetricType = (typeof METRIC_TYPES)[number]

export const METRIC_TYPE_LABELS_KO: Record<MetricType, string> = {
  cpu: 'CPU 사용률',
  memory: '메모리 사용률',
  disk_io: '디스크 I/O 지연',
  network_rx: '네트워크 수신',
  network_tx: '네트워크 송신',
  http_latency: 'HTTP 응답 지연',
  log_error_rate: '로그 에러 발생률',
}

/** 메트릭 종류별 단위 — 사용자가 override_threshold 입력 시 참고용 */
export const METRIC_TYPE_UNITS: Record<MetricType, string> = {
  cpu: '%',
  memory: '%',
  disk_io: 'ms',
  network_rx: 'MB/s',
  network_tx: 'MB/s',
  http_latency: 'ms',
  log_error_rate: '건/분',
}

const TITLE_PATTERNS: { regex: RegExp; type: MetricType }[] = [
  { regex: /CPU\s*평균/, type: 'cpu' },
  { regex: /메모리\s*사용률/, type: 'memory' },
  { regex: /디스크\s*I\/?O/i, type: 'disk_io' },
  { regex: /네트워크\s*RX/i, type: 'network_rx' },
  { regex: /네트워크\s*TX/i, type: 'network_tx' },
  { regex: /HTTP\s*지연/, type: 'http_latency' },
  { regex: /로그\s*에러/, type: 'log_error_rate' },
]

/** prometheus_analyzer 알림 title에서 메트릭 종류 추출 (metric_types 컬럼 폴백). */
export function extractMetricTypesFromTitle(title: string | null | undefined): MetricType[] {
  if (!title) return []
  const found: MetricType[] = []
  for (const { regex, type } of TITLE_PATTERNS) {
    if (regex.test(title) && !found.includes(type)) found.push(type)
  }
  return found
}

/** prometheus_analyzer 알림 여부 판단 */
export function isMetricAnalyzerAlert(alert: {
  alertname: string | null
  instance_role: string | null
}): boolean {
  return (
    alert.alertname === 'prometheus_analyzer_anomaly' ||
    alert.instance_role === 'prometheus_analyzer'
  )
}
