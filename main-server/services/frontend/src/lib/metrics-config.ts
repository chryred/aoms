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

/** 수집 현황 카드 도움말 — 집계 기준 및 임계치 설명 */
export const METRIC_HINTS: Record<string, string> = {
  cpu: '집계 기준: 인스턴스 중 최고 CPU 사용률 (5분 max)\n정상 ≤60% / 경고 ≤80% / 위험 >80%',
  memory: '집계 기준: 인스턴스 중 최고 메모리 사용률 (5분 max)\n정상 ≤60% / 경고 ≤80% / 위험 >80%',
  disk: '디스크 I/O 응답시간 수집 여부\n임계치 판정 없음 — 수집 중/미수집만 표시',
  network: '네트워크 수신 트래픽 수집 여부\n임계치 판정 없음 — 수집 중/미수집만 표시',
  log: '로그 에러 발생 건수 수집 여부\n임계치 판정 없음 — 수집 중/미수집만 표시',
  web: 'HTTP 요청 수 수집 여부\n임계치 판정 없음 — 수집 중/미수집만 표시',
  db_connections:
    '집계 기준: DB 인스턴스 중 최고 활성 커넥션 비율 (5분 max)\n정상 ≤60% / 경고 ≤80% / 위험 >80%',
  db_query: 'DB TPS(초당 트랜잭션) 수집 여부\n임계치 판정 없음 — 수집 중/미수집만 표시',
  db_cache:
    '집계 기준: DB 인스턴스 중 최저 캐시 히트율 (낮을수록 나쁨)\n정상 ≥95% / 경고 ≥80% / 위험 <80%',
  db_replication: '복제 지연 시간 수집 여부\n임계치 판정 없음 — 수집 중/미수집만 표시',
}
