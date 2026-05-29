import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
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
const FeedbackReviewPage = lazy(() =>
  import('@/pages/FeedbackReviewPage').then((m) => ({ default: m.FeedbackReviewPage })),
)
const FeedbackRevisePage = lazy(() =>
  import('@/pages/FeedbackRevisePage').then((m) => ({ default: m.FeedbackRevisePage })),
)
const FeedbackManagePage = lazy(() =>
  import('@/pages/FeedbackManagePage').then((m) => ({ default: m.FeedbackManagePage })),
)

function FeedbackSearchRedirect() {
  const location = useLocation()
  const qs = location.search ? `${location.search}&tab=search` : '?tab=search'
  return <Navigate to={`${ROUTES.FEEDBACK_MANAGE}${qs}`} replace />
}
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
const KnowledgePage = lazy(() =>
  import('@/pages/KnowledgePage').then((m) => ({ default: m.KnowledgePage })),
)
const ChatPage = lazy(() => import('@/pages/ChatPage').then((m) => ({ default: m.ChatPage })))
const GuestEntryPage = lazy(() =>
  import('@/pages/GuestEntryPage').then((m) => ({ default: m.GuestEntryPage })),
)
const OAuthLoginPage = lazy(() =>
  import('@/pages/OAuthLoginPage').then((m) => ({ default: m.OAuthLoginPage })),
)
const OAuthClientsPage = lazy(() =>
  import('@/pages/admin/OAuthClientsPage').then((m) => ({ default: m.OAuthClientsPage })),
)
const SslDashboardPage = lazy(() =>
  import('@/pages/ssl/SslDashboardPage').then((m) => ({ default: m.SslDashboardPage })),
)
const SslServersPage = lazy(() =>
  import('@/pages/ssl/SslServersPage').then((m) => ({ default: m.SslServersPage })),
)
const SslDeploymentHistoryPage = lazy(() =>
  import('@/pages/ssl/SslDeploymentHistoryPage').then((m) => ({
    default: m.SslDeploymentHistoryPage,
  })),
)
const RootCaGuidePage = lazy(() =>
  import('@/pages/ssl/RootCaGuidePage').then((m) => ({ default: m.RootCaGuidePage })),
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

        {/* 게스트 채팅 — 로그인 불필요 */}
        <Route
          path={ROUTES.CHAT_GUEST}
          element={
            <Suspense fallback={<LoadingSkeleton shape="card" />}>
              <GuestEntryPage />
            </Suspense>
          }
        />

        {/* OIDC OAuth 로그인 페이지 — 타시스템 SSO 진입점 (인증 불필요) */}
        <Route
          path={ROUTES.OAUTH_LOGIN}
          element={
            <Suspense fallback={<LoadingSkeleton shape="card" />}>
              <OAuthLoginPage />
            </Suspense>
          }
        />

        {/* Root CA 가이드 — 인증 불필요 (사내 브라우저 인증서 설치) */}
        <Route
          path={ROUTES.SSL_CA_GUIDE}
          element={
            <Suspense fallback={<LoadingSkeleton shape="card" />}>
              <RootCaGuidePage />
            </Suspense>
          }
        />

        {/* /feedback/submit — Teams 카드 "해결책 등록" 버튼 제거(Wave 2B) 후 즐겨찾기 진입 대비 redirect */}
        <Route path={ROUTES.FEEDBACK_SUBMIT} element={<Navigate to={ROUTES.INCIDENTS} replace />} />
        <Route
          path={ROUTES.FEEDBACK_REVIEW}
          element={
            <AuthGuard>
              <Suspense fallback={<LoadingSkeleton shape="card" />}>
                <FeedbackReviewPage />
              </Suspense>
            </AuthGuard>
          }
        />
        <Route
          path={ROUTES.FEEDBACK_REVISE}
          element={
            <AuthGuard>
              <Suspense fallback={<LoadingSkeleton shape="card" />}>
                <FeedbackRevisePage />
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
          {/* /feedback — 인시던트 단위로 전환됨 (Wave 3C). /incidents 로 redirect */}
          <Route path="/feedback" element={<Navigate to={ROUTES.INCIDENTS} replace />} />
          <Route path={ROUTES.FEEDBACK_SEARCH} element={<FeedbackSearchRedirect />} />
          <Route
            path={ROUTES.FEEDBACK_MANAGE}
            element={
              <Suspense fallback={<LoadingSkeleton shape="table" />}>
                <FeedbackManagePage />
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
          <Route
            path={ROUTES.KNOWLEDGE}
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={3} />}>
                <KnowledgePage />
              </Suspense>
            }
          />
          <Route
            path={ROUTES.CHAT}
            element={
              <Suspense fallback={<LoadingSkeleton shape="card" count={3} />}>
                <ChatPage />
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
              path={ROUTES.ADMIN_OAUTH_CLIENTS}
              element={
                <Suspense fallback={<LoadingSkeleton shape="table" />}>
                  <OAuthClientsPage />
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
            <Route
              path={ROUTES.SSL_DASHBOARD}
              element={
                <Suspense fallback={<LoadingSkeleton shape="card" count={3} />}>
                  <SslDashboardPage />
                </Suspense>
              }
            />
            <Route
              path={ROUTES.SSL_SERVERS}
              element={
                <Suspense fallback={<LoadingSkeleton shape="table" />}>
                  <SslServersPage />
                </Suspense>
              }
            />
            <Route
              path={ROUTES.SSL_DEPLOYMENTS}
              element={
                <Suspense fallback={<LoadingSkeleton shape="table" />}>
                  <SslDeploymentHistoryPage />
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
