import { matchPath, useLocation } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { useChatContextStore } from '@/store/chatContextStore'
import { useSystems } from '@/hooks/queries/useSystems'
import type { ScreenContext } from '@/types/chat'

interface ScreenInfo {
  screenKey: string
  screenLabel: string
  traceId?: string
  spanId?: string
}

export function resolveScreen(pathname: string): ScreenInfo {
  // /apm/tx/:traceId/:spanId — 건별 트랜잭션 상세 (APM 경로 중 가장 구체적)
  const tx = matchPath('/apm/tx/:traceId/:spanId', pathname)
  if (tx?.params.traceId && tx.params.spanId) {
    return {
      screenKey: 'apm_tx_detail',
      screenLabel: '트랜잭션 상세',
      traceId: tx.params.traceId,
      spanId: tx.params.spanId,
    }
  }
  if (pathname.startsWith(ROUTES.APM_LIVE)) {
    return { screenKey: 'apm_live', screenLabel: '실시간 모니터링' }
  }
  if (pathname.startsWith(ROUTES.APM_TRANSACTIONS)) {
    return { screenKey: 'apm_transactions', screenLabel: '트랜잭션 분석' }
  }
  // /dashboard/:id — 시스템 상세 페이지 (더 구체적인 패턴을 먼저 검사)
  if (/^\/dashboard\/\d+/.test(pathname)) {
    return { screenKey: 'systems', screenLabel: '시스템 상세' }
  }
  if (pathname.startsWith(ROUTES.DASHBOARD)) {
    return { screenKey: 'dashboard', screenLabel: '운영 대시보드' }
  }
  // /incidents/:id — 인시던트 상세 (더 구체적인 패턴을 먼저 검사)
  if (/^\/incidents\/\d+/.test(pathname)) {
    return { screenKey: 'incidents', screenLabel: '인시던트 상세' }
  }
  if (pathname.startsWith(ROUTES.INCIDENTS)) {
    return { screenKey: 'incidents', screenLabel: '인시던트' }
  }
  if (pathname.startsWith(ROUTES.SYSTEMS)) {
    return { screenKey: 'systems', screenLabel: '시스템 관리' }
  }
  if (pathname.startsWith(ROUTES.REPORTS)) {
    return { screenKey: 'reports', screenLabel: '리포트' }
  }
  if (pathname.startsWith(ROUTES.KNOWLEDGE)) {
    return { screenKey: 'knowledge', screenLabel: '지식 베이스' }
  }
  if (pathname.startsWith(ROUTES.ALERTS)) {
    return { screenKey: 'alerts', screenLabel: '알림' }
  }
  return { screenKey: '', screenLabel: '' }
}

/**
 * 현재 URL 경로와 chatContextStore의 contextIds를 결합하여 ScreenContext를 반환한다.
 * screen/screen_label/trace_id/span_id는 pathname에서 도출, system_id/incident_id는 페이지가 등록한 값 사용.
 * system_name은 시스템 목록에서 system_id 로 찾는다(보조값 — 백엔드가 최종 확정).
 * 개별 프리미티브 선택자를 사용하여 Zustand getSnapshot 무한루프 경고를 방지한다.
 */
export function useScreenContext(): ScreenContext {
  const { pathname } = useLocation()
  // 프리미티브 개별 선택 — 객체 통째로 선택하면 매 렌더마다 새 참조가 생겨 경고 발생
  const systemId = useChatContextStore((s) => s.contextIds.system_id)
  const incidentId = useChatContextStore((s) => s.contextIds.incident_id)
  const { data: systems } = useSystems()

  const { screenKey, screenLabel, traceId, spanId } = resolveScreen(pathname)

  const ctx: ScreenContext = {}
  if (screenKey) ctx.screen = screenKey
  if (screenLabel) ctx.screen_label = screenLabel
  if (systemId) {
    ctx.system_id = systemId
    const name = systems?.find((s) => String(s.id) === systemId)?.system_name
    if (name) ctx.system_name = name
  }
  if (incidentId) ctx.incident_id = incidentId
  if (traceId) ctx.trace_id = traceId
  if (spanId) ctx.span_id = spanId

  return ctx
}
