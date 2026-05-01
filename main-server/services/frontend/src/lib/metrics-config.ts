/**
 * 메트릭 그룹 관련 상수.
 * 새 메트릭 그룹을 추가할 때 이 파일만 수정하면 된다 (OCP).
 */

/** 수집기별 섹션 레이블 */
export const COLLECTOR_SECTION_LABELS: Record<string, string> = {
  synapse_agent: '수집기',
  db_exporter: 'DB',
}

/** 차트 표시 순서 */
export const GROUP_ORDER = [
  'cpu',
  'memory',
  'disk',
  'network',
  'log',
  'web',
  'db_connections',
  'db_query',
  'db_cache',
  'db_replication',
]

/** 그룹별 한글 제목 */
export const CHART_TITLES: Record<string, string> = {
  cpu: 'CPU 사용률',
  memory: '메모리 사용률',
  disk: '디스크 I/O',
  network: '네트워크 트래픽',
  log: '로그 에러 추이',
  web: '웹 요청 추이',
  db_connections: 'DB 커넥션',
  db_query: 'DB 쿼리 처리량',
  db_cache: 'DB 캐시 적중률',
  db_replication: 'DB 복제 지연',
}

/** 그룹별 단위 (없는 경우 undefined) */
export const UNIT_MAP: Record<string, string | undefined> = {
  cpu: '%',
  memory: '%',
  disk: 'MB',
  network: 'MB',
  db_cache: '%',
  db_replication: 's',
}

/** 집계 뷰에서 기본으로 숨길 서브메트릭 키 (인스턴스 뷰에는 미적용) */
export const DEFAULT_HIDDEN_KEYS_BY_GROUP: Record<string, string[]> = {
  cpu: ['cpu_avg', 'cpu_p95', 'load1', 'load5'],
}
