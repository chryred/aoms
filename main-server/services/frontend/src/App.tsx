import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { AdminGuard } from '@/components/layout/AdminGuard'
import { LoginPage } from '@/pages/auth/LoginPage'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'

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
const ContactFormPage = lazy(() =>
  import('@/pages/ContactFormPage').then((m) => ({ default: m.ContactFormPage })),
)
const SystemDetailPage = lazy(() =>
  import('@/pages/SystemDetailPage').then((m) => ({ default: m.SystemDetailPage })),
)
const ReportPage = lazy(() => import('@/pages/ReportPage').then((m) => ({ default: m.ReportPage })))
const ReportHistoryPage = lazy(() =>
  import('@/pages/ReportHistoryPage').then((m) => ({ default: m.ReportHistoryPage })),
)
const SimilarSearchPage = lazy(() => import('@/pages/SimilarSearchPage'))
const TrendAlertsPage = lazy(() => import('@/pages/TrendAlertsPage'))
const CollectorWizardPage = lazy(() => import('@/pages/CollectorWizardPage'))
const CollectorConfigListPage = lazy(() => import('@/pages/CollectorConfigListPage'))
const RegisterPage = lazy(() =>
  import('@/pages/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })),
)
const UserManagementPage = lazy(() =>
  import('@/pages/admin/UserManagementPage').then((m) => ({ default: m.UserManagementPage })),
)
const ProfilePage = lazy(() =>
  import('@/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
)
const FeedbackPage = lazy(() =>
  import('@/pages/FeedbackPage').then((m) => ({ default: m.FeedbackPage })),
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

        {/* 앱 레이아웃 */}
        <Route
          element={
            <AuthGuard>
              <AppLayout />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to={ROUTES.DASHBOARD} replace />} />
          <Route
            path="/dashboard"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={4} />}>
                <DashboardPage />
              </Suspense>
            }
          />
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
            path="/contacts/new"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" />}>
                <ContactFormPage />
              </Suspense>
            }
          />
          <Route
            path="/contacts/:id/edit"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" />}>
                <ContactFormPage />
              </Suspense>
            }
          />
          <Route
            path="/dashboard/:systemId"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={3} />}>
                <SystemDetailPage />
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
            path="/collector-configs"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={4} />}>
                <CollectorConfigListPage />
              </Suspense>
            }
          />
          <Route
            path="/systems/:id/wizard"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={3} />}>
                <CollectorWizardPage />
              </Suspense>
            }
          />
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
          <Route
            path="/profile"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" />}>
                <ProfilePage />
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
