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
