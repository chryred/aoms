import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import {
  LayoutDashboard,
  Bell,
  Server,
  Users,
  TrendingUp,
  BarChart3,
  Activity,
  Search,
  MessageSquare,
  FileSearch,
  UserCircle,
  ShieldCheck,
  Database,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Terminal,
  Bot,
  Wrench,
  Siren,
  BookOpen,
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
  end,
}: {
  to: string
  icon: React.ReactNode
  label: string
  badge?: number
  collapsed: boolean
  onNavigate?: () => void
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-sm px-3 py-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-150',
          'min-h-[44px]',
          'focus:ring-accent focus:ring-1 focus:outline-none',
          isActive
            ? 'bg-accent text-accent-contrast shadow-neu-pressed font-semibold'
            : 'text-text-secondary hover:bg-accent-muted hover:text-text-primary',
          collapsed && 'justify-center px-2',
        )
      }
      title={collapsed ? label : undefined}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="bg-critical ml-auto rounded-full px-1.5 py-0.5 text-xs text-white">
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
      {!collapsed && <p className="type-label mb-1 px-3">{label}</p>}
      {collapsed && <div className="border-border mb-1 border-t" />}
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

  const [accountMenuOpen, setAccountMenuOpen] = useState(false)

  const { data: unackAlerts } = useAlerts({ acknowledged: false, limit: 100 })
  const unackCount = unackAlerts?.length ?? 0

  const { data: allUsers } = useUsers()
  const pendingCount = allUsers?.filter((u) => toUserStatus(u) === 'pending').length ?? 0

  // Close mobile sidebar and account menu on navigation
  useEffect(() => {
    closeMobileSidebar()
    setAccountMenuOpen(false)
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close account menu when sidebar collapses
  useEffect(() => {
    if (collapsed) setAccountMenuOpen(false)
  }, [collapsed])

  return (
    <aside
      className={cn(
        'border-border bg-surface flex h-full shrink-0 flex-col border-r transition-[width] duration-200',
        // On mobile always full-width; on desktop: collapsed or expanded
        'w-60 md:w-auto',
        collapsed ? 'md:w-16' : 'md:w-60',
      )}
    >
      {/* 로고 */}
      <div className="border-border-brand flex items-center justify-between border-b px-4 py-3">
        {!collapsed && (
          <span className="type-heading font-lora text-accent text-lg font-bold italic">
            Synapse-V
          </span>
        )}
        {/* Collapse toggle — desktop only */}
        <button
          onClick={toggleSidebar}
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          className={cn(
            'text-text-secondary hidden h-10 w-10 items-center justify-center rounded-sm md:flex',
            'hover:bg-hover-subtle',
            'focus:ring-accent focus:ring-1 focus:outline-none',
            collapsed && 'mx-auto',
          )}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* 내비게이션 */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4">
        <NavGroup label="AI" collapsed={collapsed}>
          <NavItem
            to={ROUTES.CHAT}
            icon={<Bot className="h-4 w-4" />}
            label="AI 어시스턴트"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
        </NavGroup>

        <NavGroup label="운영" collapsed={collapsed}>
          <NavItem
            to={ROUTES.DASHBOARD}
            icon={<LayoutDashboard className="h-4 w-4" />}
            label="대시보드"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
          <NavItem
            to={ROUTES.GRAFANA}
            icon={<Activity className="h-4 w-4" />}
            label="Grafana 대시보드"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
          <NavItem
            to={ROUTES.TRENDS}
            icon={<TrendingUp className="h-4 w-4" />}
            label="장애 예측"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
        </NavGroup>

        <NavGroup label="알림" collapsed={collapsed}>
          <NavItem
            to={ROUTES.ALERTS}
            icon={<Bell className="h-4 w-4" />}
            label="알림 이력"
            badge={unackCount}
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
          <NavItem
            to={ROUTES.INCIDENTS}
            icon={<Siren className="h-4 w-4" />}
            label="인시던트"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
          <NavItem
            to={ROUTES.FEEDBACK}
            icon={<MessageSquare className="h-4 w-4" />}
            label="피드백"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
            end
          />
          <NavItem
            to={ROUTES.FEEDBACK_SEARCH}
            icon={<FileSearch className="h-4 w-4" />}
            label="해결책 검색"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
        </NavGroup>

        <NavGroup label="분석" collapsed={collapsed}>
          <NavItem
            to={ROUTES.REPORTS}
            icon={<BarChart3 className="h-4 w-4" />}
            label="안정성 리포트"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
          <NavItem
            to={ROUTES.SEARCH}
            icon={<Search className="h-4 w-4" />}
            label="유사 장애 검색"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
        </NavGroup>

        <NavGroup label="관리" collapsed={collapsed}>
          <NavItem
            to={ROUTES.KNOWLEDGE}
            icon={<BookOpen className="h-4 w-4" />}
            label="지식 관리"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
          <NavItem
            to={ROUTES.AGENTS}
            icon={<Terminal className="h-4 w-4" />}
            label="에이전트 관리"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
          <NavItem
            to={ROUTES.CLI_MANAGER}
            icon={<Bot className="h-4 w-4" />}
            label="CLI 배포 관리"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
          <NavItem
            to={ROUTES.SYSTEMS}
            icon={<Server className="h-4 w-4" />}
            label="시스템 관리"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
          <NavItem
            to={ROUTES.CONTACTS}
            icon={<Users className="h-4 w-4" />}
            label="담당자 관리"
            collapsed={collapsed}
            onNavigate={closeMobileSidebar}
          />
        </NavGroup>
      </nav>

      {/* 계정 — 접이식 메뉴 */}
      <div className="border-border relative border-t px-2 py-2">
        {/* 슬라이드업 서브메뉴 */}
        <div
          className={cn(
            'absolute right-0 bottom-full left-0 overflow-hidden transition-all duration-200 ease-in-out',
            accountMenuOpen ? 'max-h-[320px] opacity-100' : 'pointer-events-none max-h-0 opacity-0',
          )}
        >
          <div className="border-border bg-bg-deep space-y-0.5 rounded-sm border px-2 pt-1 pb-1 shadow-[0_-4px_12px_rgba(0,0,0,0.3)]">
            <NavItem
              to={ROUTES.PROFILE}
              icon={<UserCircle className="h-4 w-4" />}
              label="내 프로필"
              collapsed={collapsed}
              onNavigate={closeMobileSidebar}
            />
            {user?.role === 'admin' && (
              <>
                <NavItem
                  to={ROUTES.ADMIN_USERS}
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="사용자 관리"
                  badge={pendingCount}
                  collapsed={collapsed}
                  onNavigate={closeMobileSidebar}
                />
                <NavItem
                  to={ROUTES.ADMIN_LLM_CONFIG}
                  icon={<Bot className="h-4 w-4" />}
                  label="DevX AgentCode 관리"
                  collapsed={collapsed}
                  onNavigate={closeMobileSidebar}
                />
                <NavItem
                  to={ROUTES.ADMIN_CHAT_TOOLS}
                  icon={<Wrench className="h-4 w-4" />}
                  label="챗봇 도구 관리"
                  collapsed={collapsed}
                  onNavigate={closeMobileSidebar}
                />
                <NavItem
                  to={ROUTES.VECTOR_HEALTH}
                  icon={<Database className="h-4 w-4" />}
                  label="벡터 상태"
                  collapsed={collapsed}
                  onNavigate={closeMobileSidebar}
                />
                <NavItem
                  to={ROUTES.SCHEDULER_RUNS}
                  icon={<Activity className="h-4 w-4" />}
                  label="스케줄러 이력"
                  collapsed={collapsed}
                  onNavigate={closeMobileSidebar}
                />
              </>
            )}
          </div>
        </div>

        {/* 토글 버튼 */}
        <button
          type="button"
          onClick={() => setAccountMenuOpen((prev) => !prev)}
          className={cn(
            'flex w-full items-center gap-3 rounded-sm px-3 py-3 text-sm font-medium transition-[background-color,color] duration-150',
            'focus:ring-accent min-h-[44px] focus:ring-1 focus:outline-none',
            accountMenuOpen
              ? 'bg-accent-muted text-text-primary'
              : 'text-text-secondary hover:bg-accent-muted hover:text-text-primary',
            collapsed && 'justify-center px-2',
          )}
          title={collapsed ? '계정' : undefined}
        >
          <span className="relative shrink-0">
            <UserCircle className="h-4 w-4" />
            {pendingCount > 0 && (
              <span className="bg-critical absolute -top-1 -right-1 h-2 w-2 rounded-full" />
            )}
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left">
                {user?.name || user?.email || '계정'}
              </span>
              <ChevronUp
                className={cn(
                  'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                  accountMenuOpen ? 'rotate-0' : 'rotate-180',
                )}
              />
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
