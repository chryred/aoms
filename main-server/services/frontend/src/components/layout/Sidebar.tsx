import { NavLink } from 'react-router-dom'
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
}: {
  to: string
  icon: React.ReactNode
  label: string
  badge?: number
  collapsed: boolean
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
          'focus:outline-none focus:ring-2 focus:ring-[#6366F1]',
          isActive
            ? 'bg-[#6366F1] text-white shadow-[3px_3px_6px_#C8CBD4,-3px_-3px_6px_#FFFFFF]'
            : 'text-[#4A5568] hover:bg-[rgba(99,102,241,0.08)]',
          collapsed && 'justify-center px-2'
        )
      }
      title={collapsed ? label : undefined}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="truncate flex-1">{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="ml-auto rounded-full bg-[#DC2626] px-1.5 py-0.5 text-xs text-white">
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
        <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-[#4A5568]">
          {label}
        </p>
      )}
      {collapsed && <div className="mb-1 border-t border-[#D4D7DE]" />}
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const user = useAuthStore((s) => s.user)

  const { data: unackAlerts } = useAlerts({ acknowledged: false, limit: 100 })
  const unackCount = unackAlerts?.length ?? 0

  const { data: allUsers } = useUsers()
  const pendingCount = allUsers?.filter((u) => toUserStatus(u) === 'pending').length ?? 0

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-[#E8EBF0] border-r border-[#D4D7DE] transition-all duration-200 shrink-0',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* 로고 */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[#D4D7DE]">
        {!collapsed && (
          <span className="text-lg font-bold text-[#1A1F2E] tracking-tight">AOMS</span>
        )}
        <button
          onClick={toggleSidebar}
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          className={cn(
            'rounded-lg p-1.5 text-[#4A5568] hover:bg-[rgba(0,0,0,0.05)]',
            'focus:outline-none focus:ring-2 focus:ring-[#6366F1]',
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
          <NavItem to="/dashboard" icon={<LayoutDashboard className="w-4 h-4" />} label="대시보드" collapsed={collapsed} />
          <NavItem to="/trends" icon={<TrendingUp className="w-4 h-4" />} label="트렌드 예측" collapsed={collapsed} />
        </NavGroup>

        <NavGroup label="알림" collapsed={collapsed}>
          <NavItem to="/alerts" icon={<Bell className="w-4 h-4" />} label="알림 이력" badge={unackCount} collapsed={collapsed} />
          <NavItem to="/feedback" icon={<MessageSquare className="w-4 h-4" />} label="피드백" collapsed={collapsed} />
        </NavGroup>

        <NavGroup label="분석" collapsed={collapsed}>
          <NavItem to="/reports" icon={<BarChart3 className="w-4 h-4" />} label="안정성 리포트" collapsed={collapsed} />
          <NavItem to="/search" icon={<Search className="w-4 h-4" />} label="유사 장애 검색" collapsed={collapsed} />
        </NavGroup>

        <NavGroup label="관리" collapsed={collapsed}>
          <NavItem to="/systems" icon={<Server className="w-4 h-4" />} label="시스템 관리" collapsed={collapsed} />
          <NavItem to="/contacts" icon={<Users className="w-4 h-4" />} label="담당자 관리" collapsed={collapsed} />
          <NavItem to="/collector-configs" icon={<Settings className="w-4 h-4" />} label="수집기 설정" collapsed={collapsed} />
        </NavGroup>
      </nav>

      {/* 계정 */}
      <div className="border-t border-[#D4D7DE] px-2 py-3 space-y-0.5">
        <NavItem to="/profile" icon={<UserCircle className="w-4 h-4" />} label="내 프로필" collapsed={collapsed} />
        {user?.role === 'admin' && (
          <>
            <NavItem to="/admin/users" icon={<ShieldCheck className="w-4 h-4" />} label="사용자 관리" badge={pendingCount} collapsed={collapsed} />
            <NavItem to="/vector-health" icon={<Database className="w-4 h-4" />} label="벡터 상태" collapsed={collapsed} />
          </>
        )}
      </div>
    </aside>
  )
}
