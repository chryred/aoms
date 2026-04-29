export const GUEST_CACHE_KEY = 'synapse-guest-recent'
export const GUEST_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const GUEST_CACHE_MAX_SESSIONS = 5

export interface SessionMeta {
  session_id: string
  title: string
  created_at: string // ISO 8601 UTC (naive 또는 Z)
  last_message_at: string
  system_ids: number[]
}

export interface GuestSessionCache {
  visitor_employee_id: string
  expires_at: string // ISO 8601 UTC
  sessions: SessionMeta[]
}

/** 캐시 로드. 만료된 경우 자동 wipe + null 반환. 손상 JSON도 wipe + null */
export function loadCache(): GuestSessionCache | null {
  try {
    const raw = localStorage.getItem(GUEST_CACHE_KEY)
    if (!raw) return null

    const cache = JSON.parse(raw) as GuestSessionCache

    if (new Date(cache.expires_at).getTime() <= Date.now()) {
      wipeCache()
      return null
    }

    return cache
  } catch {
    wipeCache()
    return null
  }
}

/** 통째 삭제 */
export function wipeCache(): void {
  localStorage.removeItem(GUEST_CACHE_KEY)
}

/**
 * 사번 변경 시 wipe + 새로 시작. 같은 사번이면 sessions 갱신.
 * - last_message_at DESC 정렬, MAX_SESSIONS 초과 시 가장 오래된 것 제거
 * - 같은 session_id가 이미 있으면 last_message_at, title, system_ids 업데이트
 * - 호출 시마다 expires_at = now + TTL_MS 갱신
 */
export function addOrUpdateSession(employeeId: string, meta: SessionMeta): void {
  const now = Date.now()
  const expiresAt = new Date(now + GUEST_CACHE_TTL_MS).toISOString()

  const existing = loadCache()

  let sessions: SessionMeta[]

  if (!existing || existing.visitor_employee_id !== employeeId) {
    // 사번 다름 또는 캐시 없음: 새로 시작
    sessions = [meta]
  } else {
    const idx = existing.sessions.findIndex((s) => s.session_id === meta.session_id)
    if (idx >= 0) {
      // 기존 세션 업데이트 (in-place)
      sessions = existing.sessions.map((s, i) =>
        i === idx
          ? {
              ...s,
              last_message_at: meta.last_message_at,
              title: meta.title,
              system_ids: meta.system_ids,
            }
          : s,
      )
    } else {
      sessions = [meta, ...existing.sessions]
    }
  }

  // last_message_at DESC 정렬
  sessions.sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
  )

  // MAX_SESSIONS 초과 시 가장 오래된 것 제거
  if (sessions.length > GUEST_CACHE_MAX_SESSIONS) {
    sessions = sessions.slice(0, GUEST_CACHE_MAX_SESSIONS)
  }

  const cache: GuestSessionCache = {
    visitor_employee_id: employeeId,
    expires_at: expiresAt,
    sessions,
  }

  localStorage.setItem(GUEST_CACHE_KEY, JSON.stringify(cache))
}

/** 특정 세션만 제거 */
export function removeSession(sessionId: string): void {
  const cache = loadCache()
  if (!cache) return

  const sessions = cache.sessions.filter((s) => s.session_id !== sessionId)
  const updated: GuestSessionCache = { ...cache, sessions }
  localStorage.setItem(GUEST_CACHE_KEY, JSON.stringify(updated))
}
