import { useAuthStore } from '@/store/authStore'

/** SSE 응답 body 를 읽어 (event, data) 콜백을 호출하는 공통 파서. */
export async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = body.getReader()
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
        onEvent(eventType, JSON.parse(dataStr))
      } catch {
        // 파싱 실패 무시
      }
    }
  }
}

async function refreshToken(): Promise<string | null> {
  const base = (import.meta.env.VITE_ADMIN_API_URL as string | undefined) ?? ''
  try {
    const resp = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!resp.ok) return null
    const { access_token } = (await resp.json()) as { access_token: string }
    useAuthStore.getState().setToken(access_token)
    return access_token
  } catch {
    return null
  }
}

/**
 * Bearer 인증 fetch. 401 이면 `POST api/v1/auth/refresh` 를 1회 수행한 뒤 새 토큰으로 재시도한다.
 * refresh 실패 시 throw.
 */
export async function fetchWithRefresh(
  path: string,
  init: RequestInit & { headers?: Record<string, string> },
): Promise<Response> {
  const request = (token: string | null) =>
    fetch(path, {
      ...init,
      headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })

  const resp = await request(useAuthStore.getState().token)
  if (resp.status !== 401) return resp
  const token = await refreshToken()
  if (!token) throw new Error('인증 실패 (401)')
  return request(token)
}

/**
 * 같은 origin 의 SSE 엔드포인트(예: `/t/v1/stream`)에 Bearer 인증으로 연결해 이벤트를 소비한다.
 * 스트림이 끝나면 resolve, 연결 실패(비 2xx)는 throw — 재연결은 호출부 책임.
 */
export async function openSse(
  path: string,
  onEvent: (event: string, data: unknown) => void,
  signal: AbortSignal,
): Promise<void> {
  const resp = await fetchWithRefresh(path, { headers: { Accept: 'text/event-stream' }, signal })
  if (!resp.ok || !resp.body) throw new Error(`SSE 연결 실패 (${resp.status})`)
  await consumeSSE(resp.body, onEvent)
}
