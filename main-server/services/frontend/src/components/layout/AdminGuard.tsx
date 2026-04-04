import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'
import type { ReactNode } from 'react'

export function AdminGuard({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  if (user?.role !== 'admin') {
    toast.error('관리자 권한이 필요합니다')
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}
