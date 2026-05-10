import { adminApi } from '@/lib/ky-client'
import type {
  ChatAttachment,
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  ScreenContext,
} from '@/types/chat'
import { useAuthStore } from '@/store/authStore'

export const chatApi = {
  listSessions: (q?: string) => {
    const url = q ? `api/v1/chat/sessions?q=${encodeURIComponent(q)}` : 'api/v1/chat/sessions'
    return adminApi.get(url).json<ChatSession[]>()
  },
  patchSession: (id: string, body: { title?: string; system_ids?: number[] }) =>
    adminApi.patch(`api/v1/chat/sessions/${id}`, { json: body }).json<ChatSession>(),
  createSession: () => adminApi.post('api/v1/chat/sessions').json<ChatSession>(),
  getMessages: (sessionId: string) =>
    adminApi.get(`api/v1/chat/sessions/${sessionId}/messages`).json<ChatMessage[]>(),
  deleteSession: (sessionId: string) =>
    adminApi.delete(`api/v1/chat/sessions/${sessionId}`).then(() => undefined),
  restoreSession: (sessionId: string) =>
    adminApi.post(`api/v1/chat/sessions/${sessionId}/restore`).json<ChatSession>(),
  uploadAttachment: async (sessionId: string, file: File): Promise<ChatAttachment> => {
    const form = new FormData()
    form.append('file', file)
    return adminApi
      .post(`api/v1/chat/sessions/${sessionId}/attachments`, {
        body: form,
        timeout: 30_000,
      })
      .json<ChatAttachment>()
  },
  attachmentUrl: (sessionId: string, key: string): string => {
    const base = (import.meta.env.VITE_ADMIN_API_URL as string | undefined) ?? ''
    return `${base}/api/v1/chat/sessions/${sessionId}/attachments/${key}`
  },
}

/** SSE 응답 body를 읽어 이벤트 콜백을 호출하는 공통 파서. */
async function _consumeSSE(
  resp: Response,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  if (!resp.body) return
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep = buffer.indexOf('\n\n')
    while (sep !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      sep = buffer.indexOf('\n\n')
      const lines = frame.split('\n')
      let eventType = 'message'
      let dataStr = ''
      for (const line of lines) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim()
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim()
      }
      if (!dataStr) continue
      try {
        const data = JSON.parse(dataStr)
        onEvent({ type: eventType as ChatStreamEvent['type'], data })
      } catch {
        // 파싱 실패 무시
      }
    }
  }
}

/**
 * SSE 스트리밍 전송. ky 대신 fetch + ReadableStream으로 구현해 토큰 단위로 처리.
 * AbortController로 취소 가능.
 * @param systemId - RAG 검색 필터용 시스템 ID (null이면 전체 시스템 검색)
 * @param screenContext - 현재 화면 컨텍스트 (옵셔널, 빈 객체이면 전송하지 않음)
 */
export async function streamChatMessage(
  sessionId: string,
  content: string,
  attachmentKeys: string[],
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  systemId?: number | null,
  screenContext?: ScreenContext | null,
): Promise<void> {
  const base = (import.meta.env.VITE_ADMIN_API_URL as string | undefined) ?? ''
  const token = useAuthStore.getState().token

  const hasScreenContext =
    screenContext != null &&
    (screenContext.screen != null ||
      screenContext.system_id != null ||
      screenContext.incident_id != null)

  const resp = await fetch(`${base}/api/v1/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      content,
      attachment_keys: attachmentKeys,
      ...(systemId != null ? { system_id: systemId } : {}),
      ...(hasScreenContext ? { screen_context: screenContext } : {}),
    }),
    signal,
  })
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '')
    throw new Error(`SSE 요청 실패 (${resp.status}): ${text.slice(0, 200)}`)
  }

  return _consumeSSE(resp, onEvent)
}

/**
 * 선제적 통찰 트리거 (Feature 5C-2).
 * user 메시지 없이 인시던트 자동 분석을 시작하는 SSE 스트리밍.
 */
export async function streamAutoInsight(
  sessionId: string,
  incidentId: number,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  screenContext?: ScreenContext | null,
): Promise<void> {
  const base = (import.meta.env.VITE_ADMIN_API_URL as string | undefined) ?? ''
  const token = useAuthStore.getState().token

  const body: Record<string, unknown> = { incident_id: incidentId }
  if (screenContext != null) body.screen_context = screenContext

  const resp = await fetch(`${base}/api/v1/chat/sessions/${sessionId}/auto-insight`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '')
    throw new Error(`auto-insight 요청 실패 (${resp.status}): ${text.slice(0, 200)}`)
  }

  return _consumeSSE(resp, onEvent)
}
