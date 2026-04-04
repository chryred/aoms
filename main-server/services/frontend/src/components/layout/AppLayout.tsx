import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CriticalBanner } from '@/components/common/CriticalBanner'
import { useUiStore } from '@/store/uiStore'
import { useAlerts } from '@/hooks/queries/useAlerts'

export function AppLayout() {
  const setCriticalCount = useUiStore((s) => s.setCriticalCount)
  const criticalCount = useUiStore((s) => s.criticalCount)

  const { data: criticalAlerts } = useAlerts({
    severity: 'critical',
    acknowledged: false,
    limit: 100,
  })

  useEffect(() => {
    setCriticalCount(criticalAlerts?.length ?? 0)
  }, [criticalAlerts, setCriticalCount])

  return (
    <div className="flex h-screen overflow-hidden bg-[#E8EBF0]">
      {criticalCount > 0 && <CriticalBanner />}
      <Sidebar />
      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ marginTop: criticalCount > 0 ? '36px' : 0 }}
      >
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
