import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { AdminGuard } from '@/components/layout/AdminGuard'
import { LoginPage } from '@/pages/auth/LoginPage'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { DashboardAnimatedLayout } from '@/components/layout/DashboardAnimatedLayout'
import { AgentAnimatedLayout } from '@/components/layout/AgentAnimatedLayout'

const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const SystemListPage = lazy(() =>
  import('@/pages/system/SystemListPage').then((m) => ({ default: m.SystemListPage })),
)
const AlertHistoryPage = lazy(() =>
  import('@/pages/AlertHistoryPage').then((m) => ({ default: m.AlertHistoryPage })),
)
const ContactListPage = lazy(() =>
  import('@/pages/ContactListPage').then((m) => ({ default: m.ContactListPage })),
)
const DashboardSystemDetailPage = lazy(() =>
  import('@/pages/DashboardSystemDetailPage').then((m) => ({
    default: m.DashboardSystemDetailPage,
  })),
)
const ReportPage = lazy(() => import('@/pages/ReportPage').then((m) => ({ default: m.ReportPage })))
const ReportHistoryPage = lazy(() =>
  import('@/pages/ReportHistoryPage').then((m) => ({ default: m.ReportHistoryPage })),
)
const SimilarSearchPage = lazy(() => import('@/pages/SimilarSearchPage'))
const TrendAlertsPage = lazy(() => import('@/pages/TrendAlertsPage'))
const RegisterPage = lazy(() =>
  import('@/pages/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })),
)
const UserManagementPage = lazy(() =>
  import('@/pages/admin/UserManagementPage').then((m) => ({ default: m.UserManagementPage })),
)
const LlmAgentConfigPage = lazy(() =>
  import('@/pages/admin/LlmAgentConfigPage').then((m) => ({ default: m.LlmAgentConfigPage })),
)
const ChatToolsPage = lazy(() => import('@/pages/admin/ChatToolsPage'))
const CliManagerPage = lazy(() =>
  import('@/pages/CliManagerPage').then((m) => ({ default: m.CliManagerPage })),
)
const ProfilePage = lazy(() =>
  import('@/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
)
const FeedbackPage = lazy(() =>
  import('@/pages/FeedbackPage').then((m) => ({ default: m.FeedbackPage })),
)
const FeedbackSubmitPage = lazy(() =>
  import('@/pages/FeedbackSubmitPage').then((m) => ({ default: m.FeedbackSubmitPage })),
)
const FeedbackSearchPage = lazy(() =>
  import('@/pages/FeedbackSearchPage').then((m) => ({ default: m.FeedbackSearchPage })),
)
const VectorHealthPage = lazy(() =>
  import('@/pages/VectorHealthPage').then((m) => ({ default: m.VectorHealthPage })),
)
const AgentListPage = lazy(() =>
  import('@/pages/AgentListPage').then((m) => ({ default: m.AgentListPage })),
)
const AgentDetailPage = lazy(() =>
  import('@/pages/AgentDetailPage').then((m) => ({ default: m.AgentDetailPage })),
)
const GrafanaDashboardPage = lazy(() =>
  import('@/pages/GrafanaDashboardPage').then((m) => ({ default: m.GrafanaDashboardPage })),
)
const IncidentListPage = lazy(() =>
  import('@/pages/IncidentListPage').then((m) => ({ default: m.IncidentListPage })),
)
const IncidentDetailPage = lazy(() =>
  import('@/pages/IncidentDetailPage').then((m) => ({ default: m.IncidentDetailPage })),
)
const SchedulerRunHistoryPage = lazy(() =>
  import('@/pages/SchedulerRunHistoryPage').then((m) => ({ default: m.SchedulerRunHistoryPage })),
)

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 인증 레이아웃 */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/register"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" />}>
                <RegisterPage />
              </Suspense>
            }
          />
        </Route>

        {/* Teams 팝업용 단독 페이지 (사이드바/TopBar 없이 AuthGuard만) */}
        <Route
          path={ROUTES.FEEDBACK_SUBMIT}
          element={
            <AuthGuard>
              <Suspense fallback={<LoadingSkeleton shape="card" />}>
                <FeedbackSubmitPage />
              </Suspense>
            </AuthGuard>
          }
        />

        {/* 앱 레이아웃 */}
        <Route
          element={
            <AuthGuard>
              <AppLayout />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to={ROUTES.DASHBOARD} replace />} />
          <Route element={<DashboardAnimatedLayout />}>
            <Route
              path="/dashboard"
              element={
                <Suspense fallback={<LoadingSkeleton shape="card" count={4} />}>
                  <DashboardPage />
                </Suspense>
              }
            />
            <Route
              path="/dashboard/:systemId"
              element={
                <Suspense fallback={<LoadingSkeleton shape="card" count={3} />}>
                  <DashboardSystemDetailPage />
                </Suspense>
              }
            />
          </Route>
          <Route
            path="/systems"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={4} />}>
                <SystemListPage />
              </Suspense>
            }
          />
          <Route
            path="/alerts"
            element={
              <Suspense fallback={<LoadingSkeleton shape="table" />}>
                <AlertHistoryPage />
              </Suspense>
            }
          />

          {/* Phase 2 */}
          <Route
            path="/contacts"
            element={
              <Suspense fallback={<LoadingSkeleton shape="table" />}>
                <ContactListPage />
              </Suspense>
            }
          />
          <Route
            path="/reports"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={3} />}>
                <ReportPage />
              </Suspense>
            }
          />
          <Route
            path="/reports/history"
            element={
              <Suspense fallback={<LoadingSkeleton shape="table" />}>
                <ReportHistoryPage />
              </Suspense>
            }
          />
          <Route
            path="/trends"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={5} />}>
                <TrendAlertsPage />
              </Suspense>
            }
          />
          <Route
            path="/search"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={3} />}>
                <SimilarSearchPage />
              </Suspense>
            }
          />
          <Route
            path="/feedback"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={4} />}>
                <FeedbackPage />
              </Suspense>
            }
          />
          <Route
            path={ROUTES.FEEDBACK_SEARCH}
            element={
              <Suspense fallback={<LoadingSkeleton shape="table" />}>
                <FeedbackSearchPage />
              </Suspense>
            }
          />
          <Route
            path={ROUTES.INCIDENTS}
            element={
              <Suspense fallback={<LoadingSkeleton shape="table" />}>
                <IncidentListPage />
              </Suspense>
            }
          />
          <Route
            path="/incidents/:id"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={3} />}>
                <IncidentDetailPage />
              </Suspense>
            }
          />
          <Route
            path="/grafana-dashboard"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" />}>
                <GrafanaDashboardPage />
              </Suspense>
            }
          />
          <Route element={<AgentAnimatedLayout />}>
            <Route
              path="/agents"
              element={
                <Suspense fallback={<LoadingSkeleton shape="card" count={4} />}>
                  <AgentListPage />
                </Suspense>
              }
            />
            <Route
              path="/agents/:id"
              element={
                <Suspense fallback={<LoadingSkeleton shape="card" count={3} />}>
                  <AgentDetailPage />
                </Suspense>
              }
            />
          </Route>
          <Route
            path="/profile"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" />}>
                <ProfilePage />
              </Suspense>
            }
          />
          <Route
            path="/synapse-cli"
            element={
              <Suspense fallback={<LoadingSkeleton shape="table" />}>
                <CliManagerPage />
              </Suspense>
            }
          />

          {/* Admin 전용 */}
          <Route
            element={
              <AdminGuard>
                <Outlet />
              </AdminGuard>
            }
          >
            <Route
              path="/admin/users"
              element={
                <Suspense fallback={<LoadingSkeleton shape="table" />}>
                  <UserManagementPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/llm-config"
              element={
                <Suspense fallback={<LoadingSkeleton shape="table" />}>
                  <LlmAgentConfigPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/chat-tools"
              element={
                <Suspense fallback={<LoadingSkeleton shape="table" />}>
                  <ChatToolsPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/scheduler-runs"
              element={
                <Suspense fallback={<LoadingSkeleton shape="table" />}>
                  <SchedulerRunHistoryPage />
                </Suspense>
              }
            />
            <Route
              path="/vector-health"
              element={
                <Suspense fallback={<LoadingSkeleton shape="card" count={4} />}>
                  <VectorHealthPage />
                </Suspense>
              }
            />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to={ROUTES.DASHBOARD} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
