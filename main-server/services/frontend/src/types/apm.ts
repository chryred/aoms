/** Agent-T APM 타입. SSE 이벤트 형식은 contracts/agent-t/sse-events.md 와 동일 (시각은 ms epoch UTC). */

export interface TxSummary {
  trace_id: string
  span_id: string
  parent_span: string
  system_id: number
  system_name: string
  instance_role: string
  start_ts: string
  uri: string
  method: string
  status: number
  error: number
  exc_class: string
  elapsed_ms: number
  cpu_ms: number
  sql_ms: number
  sql_cnt: number
  fetch_cnt: number
  fetch_ms: number
  ext_ms: number
  ext_cnt: number
  conn_open: number
  conn_close: number
  conn_leak: number
  conn_uncommit: number
  user_ip: string
  user_id: string
  biz_key: string
  has_detail: number
  /** 에이전트가 설치된 호스트명 (없으면 빈 문자열/undefined) */
  host?: string
}

export interface TxSql {
  sql_id: string
  sql_text: string
  cnt: number
  ms: number
  max_ms: number
  fetch_cnt: number
  fetch_ms: number
  err: number
  /** 접속 DB 명 (미수집이면 빈 문자열/undefined) */
  db?: string
}

export interface TxNode {
  i: number
  p: number
  k: 'http' | 'sql' | 'ext'
  n: string
  s: number
  d: number
  sql_id: string
}

export interface StackSample {
  f: string[]
  c: number
}

export interface TxParams {
  /** 쿼리 스트링 */
  q: string
  /** [이름, 값] — 마스킹된 값은 "****" */
  p: [string, string][]
  /** 일부 생략됨 (truncated) */
  t: boolean
}

export interface TxDetail {
  summary: TxSummary
  sql: TxSql[]
  detail: { nodes: TxNode[]; stacks: StackSample[] } | null
  path: TxSummary[]
  /** 사용자 전문(요청 파라미터) — 수집 안 됐으면 null */
  params?: TxParams | null
}

export interface TxCounts {
  total: number
  normal: number
  error: number
}

export interface TxListResult {
  items: TxSummary[]
  has_more: boolean
  /** 조회 조건 전체 건수 (limit/offset 무관). 구버전 응답에는 없을 수 있다 */
  counts?: TxCounts
}

export type TxOrderBy =
  | 'start_ts'
  | 'elapsed_ms'
  | 'sql_ms'
  | 'cpu_ms'
  | 'fetch_cnt'
  | 'sql_cnt'
  | 'ext_ms'

export interface TxListParams {
  system_ids: number[]
  instance_role?: string
  start?: string
  end?: string
  uri?: string
  user_ip?: string
  user_id?: string
  min_elapsed_ms?: number
  max_elapsed_ms?: number
  min_sql_ms?: number
  error_only?: boolean
  trace_id?: string
  span_id?: string
  biz_key?: string
  min_fetch_cnt?: number
  min_sql_cnt?: number
  min_conn_open?: number
  order_by?: TxOrderBy
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/** 목록 필터 — 정렬·페이징을 제외한 조건 (통계·시간대 집계에도 동일하게 적용) */
export type TxFilterParams = Omit<TxListParams, 'limit' | 'offset' | 'order_by' | 'order'>

export interface TxUriStat {
  uri: string
  count: number
  error_count: number
  /** 전체 대비 비율 — 백분율 0~100 (소수 1자리, 서버가 count/total*100 으로 계산) */
  ratio: number
  elapsed_max: number
  elapsed_avg: number
  sql_max: number
  sql_avg: number
  ext_max: number
  ext_avg: number
  ap_avg: number
}

export interface TxUriStatsResult {
  items: TxUriStat[]
  total: number
}

export interface TxHourlyBucket {
  /** KST 시각 '00'..'23' */
  hour: string
  count: number
  elapsed_avg: number
  sql_avg_per_exec: number
}

export interface TxHourlyResult {
  items: TxHourlyBucket[]
}

export interface ScatterPoint {
  ts: number
  elapsed_ms: number
  error: boolean | number
  trace_id: string
  span_id: string
  system_id: number
}

export interface ScatterParams {
  system_ids: number[]
  start?: string
  end?: string
  limit?: number
}

export interface ScatterResult {
  points: ScatterPoint[]
  truncated: boolean
}

export interface ApmSystemSummary {
  has_agent_t: boolean
  tps_1h: number
  avg_ms_1h: number
  slow_count_1h: number
  slow_threshold_ms: number
}

export type WidgetType =
  | 'queue'
  | 'scatter'
  | 'active_list'
  | 'tps'
  | 'avg_ms'
  | 'err_rate'
  | 'uri_top'
  | 'sql_top'
  | 'jvm_users_threads'
  | 'jvm_cpu'
  | 'jvm_heap_gc'
  | 'jvm_conn_pool'

export interface DashboardWidget {
  i: string
  type: WidgetType
  x: number
  y: number
  w: number
  h: number
  target?: { system_ids?: number[]; instance_role?: string }
}

export interface ApmDashboard {
  id: number
  name: string
  layout: DashboardWidget[]
  filters: Record<string, unknown>
  is_shared_default: boolean
  owner_user_id: number
  updated_at: string
}

export interface ApmDashboardBody {
  name: string
  layout: DashboardWidget[]
  filters: Record<string, unknown>
}

export interface ThreadDumpRequestResult {
  command_id: number
}

export interface ThreadDumpListItem {
  command_id: number
  status: string
  requested_at: string
  truncated: boolean | null
}

export interface ThreadDump {
  text: string
  truncated: boolean
  ts: string
}

// ── SSE 이벤트 ──
export interface ActiveTop {
  trace_id: string
  span_id: string
  thread: string
  uri: string
  start_ts: number
  elapsed_ms: number
  phase: string
  sql: string
  /** 프레임 문자열 배열 (gateway `[]string` — 샘플이 없으면 null) */
  stack: string[] | null
}

export interface LiveActiveEvent {
  system_id: number
  instance_role: string
  ts: number
  slow_ms: number
  /** [정상, 경고, 위험] */
  buckets: number[]
  top: ActiveTop[]
}

export interface LivePoint {
  ts: number
  elapsed_ms: number
  error: boolean | number
  trace_id: string
  span_id: string
}

export interface LivePointsEvent {
  system_id: number
  instance_role: string
  points: LivePoint[]
}

/** Agent-T jvm.pools[] — DB 커넥션 풀 1개 (max <= 0 이면 상한 미상) */
export interface LivePoolStat {
  name: string
  /** jeus | hikari | tomcat | dbcp2 */
  kind: string
  active: number
  idle: number
  max: number
  /** 커넥션을 기다리는 스레드 수 */
  wait: number
}

export interface LiveAggEvent {
  system_id: number
  instance_role: string
  ts: number
  tps: number
  avg_ms: number
  err_rate: number
  slow_cnt: number
  uri_top: { uri: string; cnt: number; ms: number }[]
  sql_top: { sql: string; cnt: number; ms: number }[]
  jvm: Record<string, unknown> | null
  dropped: { detail: number; sql: number; tx: number }
}

export interface LiveSnapshotInstance {
  system_id: number
  instance_role: string
  last_seen: number
  active: LiveActiveEvent | null
  agg: LiveAggEvent[]
}

export interface LiveSnapshot {
  instances: LiveSnapshotInstance[]
}
