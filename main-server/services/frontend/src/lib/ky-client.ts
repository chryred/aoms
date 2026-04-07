import ky, { type BeforeRequestHook, type AfterResponseHook } from 'ky'
import { useAuthStore } from '@/store/authStore'

const beforeRequest: BeforeRequestHook = (request) => {
  const token = useAuthStore.getState().token
  if (token) request.headers.set('Authorization', `Bearer ${token}`)
}

const afterResponse: AfterResponseHook = async (request, _options, response) => {
  if (response.status !== 401) return
  // 로그인 엔드포인트의 401은 잘못된 자격증명 → refresh 스킵, 호출부 onError로 전달
  if (request.url.includes('/auth/login')) return

  try {
    const base = (import.meta.env.VITE_ADMIN_API_URL as string | undefined) ?? ''
    const refreshResp = await ky
      .post(`${base}/api/v1/auth/refresh`, { credentials: 'include' })
      .json<{ access_token: string }>()

    useAuthStore.getState().setToken(refreshResp.access_token)
    request.headers.set('Authorization', `Bearer ${refreshResp.access_token}`)
    return ky(request)
  } catch {
    useAuthStore.getState().logout()
    window.location.href = '/login'
  }
}

const hooks = { beforeRequest: [beforeRequest], afterResponse: [afterResponse] }

export const adminApi = ky.create({
  prefixUrl: (import.meta.env.VITE_ADMIN_API_URL as string | undefined) ?? '/',
  credentials: 'include',
  timeout: 10_000,
  hooks,
})

export const logAnalyzerApi = ky.create({
  prefixUrl: (import.meta.env.VITE_LOG_ANALYZER_URL as string | undefined) ?? '/',
  credentials: 'include',
  timeout: 15_000,
  hooks,
})

/** undefined / null 값을 제거한 searchParams 객체 반환 */
export function filterParams<T extends object>(params: T): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
  ) as Record<string, string | number | boolean>
}
