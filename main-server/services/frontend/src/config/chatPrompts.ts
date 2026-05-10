/**
 * 화면별 quick prompt chips 매핑.
 * ChatPage/ChatPanel의 빈 메시지 화면에서 screen key를 키로 조회한다.
 */
export const SCREEN_PROMPTS: Record<string, string[]> = {
  dashboard: ['최근 알람 패턴은?', '메트릭 급상승 원인은?'],
  incidents: ['이 인시던트 유사 사례?', '근본 원인 추정?'],
  systems: ['이 시스템 안정성 점수?', '최근 변경 이력은?'],
  reports: ['이번 주 패턴은?', '전주 대비 차이는?'],
  knowledge: ['관련 운영 가이드는?', '유사 해결책 사례는?'],
  alerts: ['최근 위험 알림 정리해줘', '이번 주 알림 추세는?'],
}

/** 인시던트 status별 추천 prompt chip — Feature 5C 선제적 통찰. */
import type { IncidentStatus } from '@/api/incidents'

export const INCIDENT_STATUS_PROMPTS: Record<IncidentStatus, string[]> = {
  open: ['이 인시던트 영향 범위 분석', '관련 알림 정리해줘', '담당자 누구야?'],
  acknowledged: ['비슷한 사례 찾아줘', '체크해야 할 메트릭은?', '관련 운영 가이드 보여줘'],
  investigating: [
    '근본 원인 추정',
    '관련 LLM 분석 결과',
    '이 시스템 최근 패턴',
    '비슷한 사후분석 사례',
  ],
  resolved: ['사후분석 초안 작성', '이 해결책 가이드로 저장', '비슷한 재발 사례 있나?'],
  closed: ['이 사건 요약 정리해줘', '교훈을 가이드로 저장'],
}

/**
 * screen + incident status 조합으로 가장 적합한 prompt 배열 반환.
 *
 * - screen='incidents' & status 알 수 있음: status별 prompt
 * - screen='incidents' & status 모름: SCREEN_PROMPTS.incidents (기본)
 * - 그 외: SCREEN_PROMPTS[screen]
 */
export function getContextualPrompts(
  screen: string | undefined,
  incidentStatus: IncidentStatus | null | undefined,
): string[] {
  if (screen === 'incidents' && incidentStatus && INCIDENT_STATUS_PROMPTS[incidentStatus]) {
    return INCIDENT_STATUS_PROMPTS[incidentStatus]
  }
  return SCREEN_PROMPTS[screen ?? ''] ?? []
}
