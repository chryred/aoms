import { ROUTES } from '@/constants/routes'
import { formatKST } from '@/lib/utils'

/** 홈 탭 — 항상 첫 번째, 닫을 수 없다. */
export const HOME_PATH = ROUTES.DASHBOARD

// 사이드바 메뉴 라벨과 동일하게 유지할 것 (Sidebar.tsx / CommandSearch.tsx)
const STATIC_TITLES: Record<string, string> = {
  [ROUTES.CHAT]: 'AI 어시스턴트',
  [ROUTES.DASHBOARD]: '대시보드',
  [ROUTES.GRAFANA]: 'Grafana 대시보드',
  [ROUTES.TRENDS]: '장애 예측',
  [ROUTES.APM_LIVE]: '실시간 모니터링',
  [ROUTES.APM_TRANSACTIONS]: '트랜잭션 분석',
  [ROUTES.ALERTS]: '알림 이력',
  [ROUTES.INCIDENTS]: '인시던트',
  [ROUTES.FEEDBACK_MANAGE]: '해결책 관리',
  [ROUTES.REPORTS]: '안정성 리포트',
  [ROUTES.REPORTS_HISTORY]: '리포트 이력',
  [ROUTES.SEARCH]: '유사 장애 검색',
  [ROUTES.SSL_DASHBOARD]: 'SSL 인증서',
  [ROUTES.SSL_SERVERS]: 'SSL 서버 관리',
  [ROUTES.SSL_DEPLOYMENTS]: 'SSL 배포 이력',
  [ROUTES.KNOWLEDGE]: '지식 관리',
  [ROUTES.AGENTS]: '에이전트 관리',
  [ROUTES.CLI_MANAGER]: 'CLI 배포 관리',
  [ROUTES.SYSTEMS]: '시스템 관리',
  [ROUTES.CONTACTS]: '담당자 관리',
  [ROUTES.PROFILE]: '내 프로필',
  [ROUTES.ADMIN_USERS]: '사용자 관리',
  [ROUTES.ADMIN_LLM_CONFIG]: 'DevX AgentCode 관리',
  [ROUTES.ADMIN_CHAT_TOOLS]: '챗봇 도구 관리',
  [ROUTES.VECTOR_HEALTH]: '벡터 상태',
  [ROUTES.SCHEDULER_RUNS]: '스케줄러 이력',
  [ROUTES.ADMIN_OAUTH_CLIENTS]: 'OAuth 클라이언트',
}

// 상세 라우트 — 페이지가 useTabTitle() 로 더 구체적인 제목(호스트, URI 등)으로 갱신할 수 있다
const DETAIL_TITLES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^\/dashboard\/([^/]+)$/, () => '시스템 상세'],
  [/^\/agents\/([^/]+)$/, (m) => `에이전트 #${m[1]}`],
  [/^\/incidents\/([^/]+)$/, (m) => `인시던트 #${m[1]}`],
  [/^\/apm\/tx\/[^/]+\/[^/]+$/, () => '트랜잭션 상세'],
]

/** 끝 슬래시 제거 — 탭 식별자(key)로 사용 */
export function normalizeTabPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

/** 산점도 영역 선택으로 열린 트랜잭션 조회 — from/to 가 모두 ISO(시각 포함)이면 범위별 별도 탭 */
function txRange(pathname: string, search: string): { from: string; to: string } | null {
  if (normalizeTabPath(pathname) !== ROUTES.APM_TRANSACTIONS) return null
  const sp = new URLSearchParams(search)
  const from = sp.get('from')
  const to = sp.get('to')
  if (!from || !to || !from.includes('T') || !to.includes('T')) return null
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return null
  return { from, to }
}

/** 탭 식별자 — 기본은 pathname. 트랜잭션 조회 범위 탭은 pathname + from/to (사용자 필터 변경은 같은 탭 유지) */
export function tabKeyFor(pathname: string, search = ''): string {
  const path = normalizeTabPath(pathname)
  const r = txRange(path, search)
  return r ? `${path}?from=${r.from}&to=${r.to}` : path
}

/** 탭 key 에서 라우트 pathname 만 추출 */
export const tabPathOf = (key: string) => key.split('?')[0]

function rangeTitle(from: string, to: string): string {
  const f = formatKST(new Date(from))
  const t = formatKST(new Date(to))
  const body =
    f.slice(0, 10) === t.slice(0, 10)
      ? `${f.slice(11)}~${t.slice(11)}`
      : `${f.slice(5)}~${t.slice(5)}`
  return `트랜잭션 조회 [${body}]`
}

/**
 * 탭으로 열 수 있는 경로의 기본 제목. 탭 대상이 아니면(redirect 전용 경로, 알 수 없는 경로) null.
 */
export function resolveTabTitle(pathname: string, search = ''): string | null {
  const path = normalizeTabPath(pathname)
  const r = txRange(path, search)
  if (r) return rangeTitle(r.from, r.to)
  if (STATIC_TITLES[path]) return STATIC_TITLES[path]
  for (const [re, fn] of DETAIL_TITLES) {
    const m = path.match(re)
    if (m) return fn(m)
  }
  return null
}

export const tabDomId = (key: string) => `app-tab-${key}`
export const tabPanelDomId = (key: string) => `app-tabpanel-${key}`
