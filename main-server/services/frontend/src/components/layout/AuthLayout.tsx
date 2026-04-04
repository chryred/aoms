import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-[#E8EBF0] flex items-center justify-center p-4">
      <Outlet />
    </div>
  )
}
