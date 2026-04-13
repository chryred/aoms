import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <div className="bg-bg-deep flex min-h-screen items-center justify-center p-4">
      <Outlet />
    </div>
  )
}
