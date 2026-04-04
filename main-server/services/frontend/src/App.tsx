import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { AdminGuard } from '@/components/layout/AdminGuard'
import { LoginPage } from '@/pages/auth/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { SystemListPage } from '@/pages/system/SystemListPage'
import { AlertHistoryPage } from '@/pages/AlertHistoryPage'
import { ContactListPage } from '@/pages/ContactListPage'
import { ContactFormPage } from '@/pages/ContactFormPage'
import { SystemDetailPage } from '@/pages/SystemDetailPage'
import { ReportPage } from '@/pages/ReportPage'
import { ReportHistoryPage } from '@/pages/ReportHistoryPage'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'

const SimilarSearchPage = lazy(() => import('@/pages/SimilarSearchPage'))
const TrendAlertsPage = lazy(() => import('@/pages/TrendAlertsPage'))
const CollectorWizardPage = lazy(() => import('@/pages/CollectorWizardPage'))
const CollectorConfigListPage = lazy(() => import('@/pages/CollectorConfigListPage'))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })))
const UserManagementPage = lazy(() => import('@/pages/admin/UserManagementPage').then((m) => ({ default: m.UserManagementPage })))
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const FeedbackPage = lazy(() => import('@/pages/FeedbackPage').then((m) => ({ default: m.FeedbackPage })))
const VectorHealthPage = lazy(() => import('@/pages/VectorHealthPage').then((m) => ({ default: m.VectorHealthPage })))


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
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/systems" element={<SystemListPage />} />
          <Route path="/alerts" element={<AlertHistoryPage />} />

          {/* Phase 2 */}
          <Route path="/contacts" element={<ContactListPage />} />
          <Route path="/contacts/new" element={<ContactFormPage />} />
          <Route path="/contacts/:id/edit" element={<ContactFormPage />} />
          <Route path="/dashboard/:systemId" element={<SystemDetailPage />} />
          <Route path="/reports" element={<ReportPage />} />
          <Route path="/reports/history" element={<ReportHistoryPage />} />
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
            path="/profile"
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" />}>
                <ProfilePage />
              </Suspense>
            }
          />

          {/* Admin 전용 */}
          <Route
            path="/admin/users"
            element={
              <AdminGuard>
                <Suspense fallback={<LoadingSkeleton shape="table" />}>
                  <UserManagementPage />
                </Suspense>
              </AdminGuard>
            }
          />
          <Route
            path="/vector-health"
            element={
              <AdminGuard>
                <Suspense fallback={<LoadingSkeleton shape="card" count={4} />}>
                  <VectorHealthPage />
                </Suspense>
              </AdminGuard>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
