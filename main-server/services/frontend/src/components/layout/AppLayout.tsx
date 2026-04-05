import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CriticalBanner } from '@/components/common/CriticalBanner'
import { useUiStore } from '@/store/uiStore'
import { useAlerts } from '@/hooks/queries/useAlerts'
import { cn } from '@/lib/utils'

export function AppLayout() {
  const setCriticalCount = useUiStore((s) => s.setCriticalCount)
  const criticalCount = useUiStore((s) => s.criticalCount)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const closeMobileSidebar = useUiStore((s) => s.closeMobileSidebar)

  const { data: criticalAlerts } = useAlerts({
    severity: 'critical',
    acknowledged: false,
    limit: 100,
  })

  useEffect(() => {
    setCriticalCount(criticalAlerts?.length ?? 0)
  }, [criticalAlerts, setCriticalCount])

  return (
    <div className="flex h-screen overflow-hidden bg-[#1E2127]">
      {/* Critical banner — fixed top */}
      {criticalCount > 0 && <CriticalBanner />}

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={closeMobileSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — overlay on mobile, static on desktop */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-30 md:relative md:z-auto md:flex md:shrink-0',
          'transition-transform duration-200 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          criticalCount > 0 && 'md:mt-9',
        )}
      >
        <Sidebar />
      </div>

      {/* Main content */}
      <div
        className={cn('flex min-w-0 flex-1 flex-col overflow-hidden', criticalCount > 0 && 'mt-9')}
      >
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
