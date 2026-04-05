import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#13151A] p-4">
      <Outlet />
    </div>
  )
}
