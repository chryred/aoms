import { adminApi } from '@/lib/ky-client'
import type {
  ChatAttachment,
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  ScreenContext,
} from '@/types/chat'
import { useAuthStore } from '@/store/authStore'
import { consumeSSE } from '@/lib/sse'

export const chatApi = {
  listSessions: (q?: string) => {
    const url = q ? `api/v1/chat/sessions?q=${encodeURIComponent(q)}` : 'api/v1/chat/sessions'
    return adminApi.get(url).json<ChatSession[]>()
  },
  patchSession: (id: string, body: { title?: string; system_ids?: number[] }) =>
    adminApi.patch(`api/v1/chat/sessions/${id}`, { json: body }).json<ChatSession>(),
  createSession: (systemIds?: number[]) =>
    adminApi
      .post('api/v1/chat/sessions', systemIds ? { json: { system_ids: systemIds } } : undefined)
      .json<ChatSession>(),
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

export function hasScreenContextValue(ctx: ScreenContext | null | undefined): boolean {
  return ctx != null && (ctx.screen != null || ctx.system_id != null || ctx.incident_id != null)
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

  const hasScreenContext = hasScreenContextValue(screenContext)

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

  return consumeSSE(resp.body, (type, data) =>
    onEvent({ type: type as ChatStreamEvent['type'], data: data as Record<string, unknown> }),
  )
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
  if (hasScreenContextValue(screenContext)) body.screen_context = screenContext

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

  return consumeSSE(resp.body, (type, data) =>
    onEvent({ type: type as ChatStreamEvent['type'], data: data as Record<string, unknown> }),
  )
}
