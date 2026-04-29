import ky from 'ky'
import type { ChatMessage, ChatStreamEvent } from '@/types/chat'

const BASE = (import.meta.env.VITE_ADMIN_API_URL as string | undefined) ?? ''

// 인증 훅 없는 독립 인스턴스 (adminApi는 401 시 /login 리다이렉트 발생)
const helpRawApi = ky.create({
  prefixUrl: BASE || '/',
  timeout: 15_000,
})

export interface HelpSystem {
  id: number
  system_name: string
  display_name: string
  description: string | null
}

export interface HelpSessionResponse {
  session_id: string
  employee_id: string
  system_id: number | null
}

export interface HelpEscalateResponse {
  incident_id: number
  status: string
}

export const helpApi = {
  getSystems: () => helpRawApi.get('api/v1/help/systems').json<HelpSystem[]>(),

  createSession: (body: { employee_id: string; email?: string; system_id?: number | null }) =>
    helpRawApi.post('api/v1/help/sessions', { json: body }).json<HelpSessionResponse>(),

  getFrequentQuestions: (limit = 10) =>
    helpRawApi
      .get('api/v1/help/questions/frequent', { searchParams: { limit } })
      .json<{ questions: { content: string; count: number }[] }>(),

  escalate: (sessionId: string, description?: string) =>
    helpRawApi
      .post(`api/v1/help/sessions/${sessionId}/escalate`, { json: { description } })
      .json<HelpEscalateResponse>(),

  getMessages: (sessionId: string, employeeId: string) =>
    helpRawApi
      .get(`api/v1/help/sessions/${sessionId}/messages`, {
        searchParams: { employee_id: employeeId },
      })
      .json<ChatMessage[]>(),
}

export async function streamGuestMessage(
  sessionId: string,
  content: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(`${BASE}/api/v1/help/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ content }),
    signal,
  })

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '')
    throw new Error(`게스트 SSE 요청 실패 (${resp.status}): ${text.slice(0, 200)}`)
  }

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
