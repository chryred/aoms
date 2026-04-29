/**
 * 챗봇 SSE 스트림/네트워크 에러를 사용자 친화 한국어 메시지로 변환.
 * - AbortError(사용자 취소)는 빈 문자열 반환 → 호출자가 toast 안 띄움
 * - SSE 요청 실패는 status code 분기 (`streamChatMessage` / `streamGuestMessage`가
 *   `Error('SSE 요청 실패 (4xx): ...')` 형태로 throw)
 */
export function describeChatError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return ''
    const msg = err.message ?? ''
    if (msg.includes('SSE 요청 실패 (401') || msg.includes('SSE 요청 실패 (403')) {
      return '세션이 만료되었어요. 다시 로그인해주세요.'
    }
    if (msg.includes('SSE 요청 실패 (404')) {
      return '대화를 찾지 못했어요. 페이지를 새로고침해주세요.'
    }
    if (msg.includes('SSE 요청 실패 (5')) {
      return '서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해주세요.'
    }
    if (msg.includes('SSE 요청 실패') || msg.includes('Failed to fetch')) {
      return '연결에 문제가 있어요. 네트워크를 확인하고 다시 시도해주세요.'
    }
  }
  return '오류가 발생했어요. 잠시 후 다시 시도해주세요.'
}
