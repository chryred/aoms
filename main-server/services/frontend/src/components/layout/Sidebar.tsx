import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Bell, Server, Users, Settings,
  TrendingUp, BarChart3, Search, MessageSquare,
  UserCircle, ShieldCheck, Database, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useAlerts } from '@/hooks/queries/useAlerts'
import { useUsers } from '@/hooks/queries/useUsers'
import { toUserStatus } from '@/types/auth'

function NavItem({
  to,
  icon,
  label,
  badge,
  collapsed,
  onNavigate,
}: {
  to: string
  icon: React.ReactNode
  label: string
  badge?: number
  collapsed: boolean
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-sm px-3 py-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-150',
          'min-h-[44px]',
          'focus:outline-none focus:ring-1 focus:ring-[#00D4FF]',
          isActive
            ? 'bg-[#00D4FF] text-[#1E2127] font-semibold shadow-[2px_2px_5px_#111317,-2px_-2px_5px_#2B2F37]'
            : 'text-[#8B97AD] hover:bg-[rgba(0,212,255,0.06)] hover:text-[#E2E8F2]',
          collapsed && 'justify-center px-2'
        )
      }
      title={collapsed ? label : undefined}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="truncate flex-1">{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="ml-auto rounded-full bg-[#EF4444] px-1.5 py-0.5 text-xs text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  )
}

function NavGroup({
  label,
  collapsed,
  children,
}: {
  label: string
  collapsed: boolean
  children: React.ReactNode
}) {
  return (
    <div className="mb-2">
      {!collapsed && (
        <p className="mb-1 px-3 type-label">
          {label}
        </p>
      )}
      {collapsed && <div className="mb-1 border-t border-[#2B2F37]" />}
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const closeMobileSidebar = useUiStore((s) => s.closeMobileSidebar)
  const user = useAuthStore((s) => s.user)
  const { pathname } = useLocation()

  const { data: unackAlerts } = useAlerts({ acknowledged: false, limit: 100 })
  const unackCount = unackAlerts?.length ?? 0

  const { data: allUsers } = useUsers()
  const pendingCount = allUsers?.filter((u) => toUserStatus(u) === 'pending').length ?? 0

  // Close mobile sidebar on navigation
  useEffect(() => {
    closeMobileSidebar()
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-[#252932] border-r border-[#2B2F37] transition-[width] duration-200 shrink-0',
        // On mobile always full-width; on desktop: collapsed or expanded
        'w-60 md:w-auto',
        collapsed ? 'md:w-16' : 'md:w-60'
      )}
    >
      {/* 로고 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#9E7B2F80]">
        {!collapsed && (
          <span className="type-heading text-lg font-bold text-[#00D4FF] font-lora italic">Synapse-V</span>
        )}
        {/* Collapse toggle — desktop only */}
        <button
          onClick={toggleSidebar}
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          className={cn(
            'hidden md:flex items-center justify-center w-10 h-10 rounded-sm text-[#8B97AD]',
            'hover:bg-[rgba(255,255,255,0.05)]',
            'focus:outline-none focus:ring-1 focus:ring-[#00D4FF]',
            collapsed && 'mx-auto'
          )}
        >
          {collapsed
            ? <ChevronRight className="w-4 h-4" />
            : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* 내비게이션 */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-4">
        <NavGroup label="운영" collapsed={collapsed}>
          <NavItem to="/dashboard" icon={<LayoutDashboard className="w-4 h-4" />} label="대시보드" collapsed={collapsed} onNavigate={closeMobileSidebar} />
          <NavItem to="/trends" icon={<TrendingUp className="w-4 h-4" />} label="트렌드 예측" collapsed={collapsed} onNavigate={closeMobileSidebar} />
        </NavGroup>

        <NavGroup label="알림" collapsed={collapsed}>
          <NavItem to="/alerts" icon={<Bell className="w-4 h-4" />} label="알림 이력" badge={unackCount} collapsed={collapsed} onNavigate={closeMobileSidebar} />
          <NavItem to="/feedback" icon={<MessageSquare className="w-4 h-4" />} label="피드백" collapsed={collapsed} onNavigate={closeMobileSidebar} />
        </NavGroup>

        <NavGroup label="분석" collapsed={collapsed}>
          <NavItem to="/reports" icon={<BarChart3 className="w-4 h-4" />} label="안정성 리포트" collapsed={collapsed} onNavigate={closeMobileSidebar} />
          <NavItem to="/search" icon={<Search className="w-4 h-4" />} label="유사 장애 검색" collapsed={collapsed} onNavigate={closeMobileSidebar} />
        </NavGroup>

        <NavGroup label="관리" collapsed={collapsed}>
          <NavItem to="/systems" icon={<Server className="w-4 h-4" />} label="시스템 관리" collapsed={collapsed} onNavigate={closeMobileSidebar} />
          <NavItem to="/contacts" icon={<Users className="w-4 h-4" />} label="담당자 관리" collapsed={collapsed} onNavigate={closeMobileSidebar} />
          <NavItem to="/collector-configs" icon={<Settings className="w-4 h-4" />} label="수집기 설정" collapsed={collapsed} onNavigate={closeMobileSidebar} />
        </NavGroup>
      </nav>

      {/* 계정 */}
      <div className="border-t border-[#2B2F37] px-2 py-3 space-y-0.5">
        <NavItem to="/profile" icon={<UserCircle className="w-4 h-4" />} label="내 프로필" collapsed={collapsed} onNavigate={closeMobileSidebar} />
        {user?.role === 'admin' && (
          <>
            <NavItem to="/admin/users" icon={<ShieldCheck className="w-4 h-4" />} label="사용자 관리" badge={pendingCount} collapsed={collapsed} onNavigate={closeMobileSidebar} />
            <NavItem to="/vector-health" icon={<Database className="w-4 h-4" />} label="벡터 상태" collapsed={collapsed} onNavigate={closeMobileSidebar} />
          </>
        )}
      </div>
    </aside>
  )
}
