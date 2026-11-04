import type { DashboardWidget } from '@/types/apm'

const w = (
  type: DashboardWidget['type'],
  x: number,
  y: number,
  width: number,
  h: number,
): DashboardWidget => ({ i: type, type, x, y, w: width, h })

/** 그리드 행 높이(px). h=4 → 카드 약 174px, h=5 → 약 220px (margin 10 포함) */
export const GRID_ROW_HEIGHT = 36
export const GRID_MARGIN = 10

/**
 * 저장된 화면이 없을 때 항상 보이는 기본 배치 (12열). 운영자가 묻는 순서대로 위에서 아래로 놓는다.
 * 1행 지금 괜찮은가(액티브 큐 + 트랜잭션 모니터링) / 2행 골든 시그널(TPS·응답) / 3행 에러·진행 중 /
 * 4행 용량(CPU·힙) / 5행 사용자·스레드·커넥션 풀 / 6행 드릴다운(URL·SQL).
 */
export const DEFAULT_LAYOUT: DashboardWidget[] = [
  w('queue', 0, 0, 7, 5),
  w('scatter', 7, 0, 5, 5),
  w('tps', 0, 5, 6, 4),
  w('avg_ms', 6, 5, 6, 4),
  w('err_rate', 0, 9, 6, 4),
  w('active_list', 6, 9, 6, 4),
  w('jvm_cpu', 0, 13, 6, 4),
  w('jvm_heap_gc', 6, 13, 6, 4),
  w('jvm_users_threads', 0, 17, 6, 4),
  w('jvm_conn_pool', 6, 17, 6, 4),
  w('uri_top', 0, 21, 6, 5),
  w('sql_top', 6, 21, 6, 5),
]

/**
 * 저장 레이아웃의 스키마 버전 (`filters.layout_version`). 기본 배치를 바꿀 때 올린다.
 * 저장본이 이 값보다 낮거나 없으면 DEFAULT_LAYOUT 으로 한 번 교체(마이그레이션)한다.
 */
export const LAYOUT_VERSION = 4

export const DEFAULT_DASHBOARD_NAME = '기본 화면'
