import { Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CriticalBanner } from '@/components/common/CriticalBanner'
import { ChatLauncher } from '@/components/chat/ChatLauncher'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { useUiStore } from '@/store/uiStore'
import { useChatStore } from '@/store/chatStore'
import { useAlertsCount } from '@/hooks/queries/useAlertsCount'
import { cn } from '@/lib/utils'

export function AppLayout() {
  const setCriticalCount = useUiStore((s) => s.setCriticalCount)
  const criticalCount = useUiStore((s) => s.criticalCount)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const closeMobileSidebar = useUiStore((s) => s.closeMobileSidebar)
  const chatOpen = useChatStore((s) => s.isOpen)

  const { data: criticalCountData } = useAlertsCount({
    severity: 'critical',
    acknowledged: false,
  })

  useEffect(() => {
    setCriticalCount(criticalCountData?.count ?? 0)
  }, [criticalCountData, setCriticalCount])

  return (
    <div className="bg-bg-base flex h-screen overflow-hidden">
      {/* Critical banner — fixed top */}
      {criticalCount > 0 && <CriticalBanner />}

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="bg-overlay fixed inset-0 z-20 md:hidden"
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
        <main
          className={cn(
            'flex-1 overscroll-y-contain scroll-smooth p-4 md:p-6',
            chatOpen ? 'overflow-hidden' : 'overflow-y-scroll',
          )}
        >
          <Outlet />
        </main>
      </div>

      {/* Chatbot floating launcher + sliding panel (all pages) */}
      <ChatLauncher />
      <ChatPanel />
    </div>
  )
}
