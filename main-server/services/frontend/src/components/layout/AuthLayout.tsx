import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-[#1E2127] flex items-center justify-center p-4">
      <Outlet />
    </div>
  )
}
