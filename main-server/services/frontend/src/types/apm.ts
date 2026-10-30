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

export interface TxDetail {
  summary: TxSummary
  sql: TxSql[]
  detail: { nodes: TxNode[]; stacks: StackSample[] } | null
  path: TxSummary[]
}

export interface TxListResult {
  items: TxSummary[]
  has_more: boolean
}

export interface TxListParams {
  system_ids: number[]
  instance_role?: string
  start?: string
  end?: string
  uri?: string
  user_ip?: string
  user_id?: string
  min_elapsed_ms?: number
  min_sql_ms?: number
  error_only?: boolean
  trace_id?: string
  limit?: number
  offset?: number
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
