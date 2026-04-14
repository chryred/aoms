import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { ROUTES } from '@/constants/routes'
import type { ReactNode } from 'react'

export function AuthGuard({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const location = useLocation()
  if (!token) {
    const target = location.pathname + location.search
    const isDefault = target === '/' || target === ROUTES.DASHBOARD
    const search = isDefault ? '' : `?redirect=${encodeURIComponent(target)}`
    return <Navigate to={`${ROUTES.LOGIN}${search}`} replace />
  }
  return <>{children}</>
}
