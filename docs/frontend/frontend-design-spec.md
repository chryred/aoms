# AOMS Frontend — 상세 설계 명세서

> `frontend-plan.md` 기반으로 도출한 구현 계약서.
> `/sc:implement` 실행 전 반드시 이 문서를 참고할 것.

---

## 1. 라우트 설계 (React Router v7)

### 1.1 라우트 트리

```
/
├── /login                          AUTH-01  (AuthLayout)
├── /register                       AUTH-02  (AuthLayout)
└── / (AppLayout — AuthGuard 적용)
    ├── /dashboard                  DASH-01  (기본 리다이렉트 대상)
    ├── /dashboard/:systemId        DASH-02
    ├── /systems                    SYS-01
    ├── /systems/new                SYS-02 (신규)
    ├── /systems/:id/edit           SYS-02 (수정)
    ├── /systems/:id/wizard         SYS-03 (수집기 마법사)
    ├── /contacts                   CNT-01
    ├── /contacts/new               CNT-02 (신규)
    ├── /contacts/:id/edit          CNT-02 (수정)
    ├── /alerts                     ALT-01
    ├── /reports                    RPT-01
    ├── /reports/history            RPT-02
    ├── /search                     SIM-01  (?q=검색어)
    ├── /trends                     TREND-01
    ├── /feedback                   FEED-01
    ├── /collector-configs          COL-01
    ├── /vector-health              VEC-01  (AdminGuard 추가)
    ├── /profile                    PROFILE
    └── /admin/users                AUTH-03 (AdminGuard 추가)
```

### 1.2 가드 컴포넌트

```tsx
// AuthGuard: 비인증 → /login
// AdminGuard: role !== 'admin' → /dashboard (403 toast)

// src/components/layout/AuthGuard.tsx
export function AuthGuard({ children }: { children: ReactNode }) {
  const token = useAuthStore(s => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

// src/components/layout/AdminGuard.tsx
export function AdminGuard({ children }: { children: ReactNode }) {
  const user = useAuthStore(s => s.user)
  if (user?.role !== 'admin') {
    toast.error('관리자 권한이 필요합니다')
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}
```

---

## 2. TypeScript 타입 정의 (`src/types/`)

> Pydantic 스키마(`schemas.py`)에서 직접 도출. `openapi-typescript`로 자동 생성 후 수동 보완.

### 2.1 `src/types/system.ts`

```typescript
export type OsType = 'linux' | 'windows'
export type SystemType = 'web' | 'was' | 'db' | 'middleware' | 'other'
export type SystemStatus = 'active' | 'inactive'

export interface System {
  id: number
  system_name: string
  display_name: string
  description: string | null
  host: string
  os_type: OsType
  system_type: SystemType
  status: SystemStatus
  teams_webhook_url: string | null
  created_at: string  // ISO 8601 UTC
  updated_at: string
}

export interface SystemCreate {
  system_name: string
  display_name: string
  description?: string
  host: string
  os_type: OsType
  system_type: SystemType
  status?: SystemStatus
  teams_webhook_url?: string
}

export type SystemUpdate = Partial<Omit<SystemCreate, 'system_name'>>
```

### 2.2 `src/types/contact.ts`

```typescript
export type ContactRole = 'primary' | 'secondary' | 'escalation'

export interface Contact {
  id: number
  name: string
  email: string | null
  teams_upn: string | null
  webhook_url: string | null
  llm_api_key: string | null   // 백엔드에서 "sk-***" 마스킹 후 반환
  agent_code: string | null
  created_at: string
}

export interface SystemContact {
  id: number
  system_id: number
  contact_id: number
  role: ContactRole
  notify_channels: string  // 콤마 구분: "teams,webhook"
}

export interface SystemContactCreate {
  contact_id: number
  role: ContactRole
  notify_channels: string
}
```

### 2.3 `src/types/alert.ts`

```typescript
export type AlertType = 'metric' | 'metric_resolved' | 'log_analysis'
export type Severity = 'info' | 'warning' | 'critical'
export type AnomalyType = 'new' | 'related' | 'recurring' | 'duplicate'

export interface AlertHistory {
  id: number
  system_id: number | null
  alert_type: AlertType
  severity: Severity
  alertname: string | null
  title: string
  description: string | null
  instance_role: string | null
  host: string | null
  acknowledged: boolean
  escalated: boolean
  anomaly_type: AnomalyType | null
  similarity_score: number | null
  qdrant_point_id: string | null
  created_at: string
}

export interface LogAnalysis {
  id: number
  system_id: number | null
  instance_role: string | null
  severity: Severity
  root_cause: string | null
  recommendation: string | null
  model_used: string | null
  alert_sent: boolean
  anomaly_type: AnomalyType | null
  similarity_score: number | null
  has_solution: boolean | null
  created_at: string
}
```

### 2.4 `src/types/aggregation.ts`

```typescript
export type PeriodType = 'monthly' | 'quarterly' | 'half_year' | 'annual'
export type LlmSeverity = 'normal' | 'warning' | 'critical'

// metrics_json 파싱 결과 (collector_type별 다름)
export interface NodeMetrics {
  cpu_avg: number; cpu_max: number
  mem_avg: number; mem_max: number
  disk_avg: number; disk_max: number
}
export interface JvmMetrics {
  heap_avg: number; heap_max: number
  gc_count: number
}
export type MetricsPayload = NodeMetrics | JvmMetrics | Record<string, number>

export interface HourlyAggregation {
  id: number
  system_id: number
  hour_bucket: string      // ISO 8601 UTC
  collector_type: string
  metric_group: string
  metrics_json: string     // JSON string → MetricsPayload
  llm_summary: string | null
  llm_severity: LlmSeverity | null
  llm_trend: string | null
  llm_prediction: string | null
  llm_model_used: string | null
  qdrant_point_id: string | null
  created_at: string
}

// ChartDataPoint: MetricChart에서 사용
export interface ChartDataPoint {
  timestamp: string       // KST 표시용
  [metric: string]: number | string
}

export interface TrendAlert {
  id: number
  system_id: number
  hour_bucket: string
  collector_type: string
  metric_group: string
  llm_severity: LlmSeverity
  llm_prediction: string
  llm_summary: string | null
}
```

### 2.5 `src/types/auth.ts`

```typescript
export type UserRole = 'admin' | 'operator'

export interface User {
  id: number
  name: string
  email: string
  role: UserRole
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  user: User
}
// refreshToken은 httpOnly 쿠키로 자동 관리
```

---

## 3. API 레이어 (`src/api/`)

### 3.1 파일-엔드포인트 매핑

| 파일 | 베이스 경로 | 함수 목록 |
|---|---|---|
| `systems.ts` | `api/v1/systems` | `getSystems`, `getSystem`, `createSystem`, `updateSystem`, `deleteSystem`, `getSystemContacts`, `addSystemContact`, `removeSystemContact` |
| `contacts.ts` | `api/v1/contacts` | `getContacts`, `getContact`, `createContact`, `updateContact`, `deleteContact` |
| `alerts.ts` | `api/v1/alerts` | `getAlerts`, `acknowledgeAlert` |
| `analysis.ts` | `api/v1/analysis` | `getAnalyses`, `getAnalysis` |
| `aggregations.ts` | `api/v1/aggregations` | `getHourlyAggregations`, `getDailyAggregations`, `getWeeklyAggregations`, `getMonthlyAggregations`, `getTrendAlerts` |
| `reports.ts` | `api/v1/reports` | `getReports`, `getReport` |
| `collectorConfig.ts` | `api/v1/collector-config` | `getConfigs`, `createConfig`, `updateConfig`, `deleteConfig`, `getTemplates` |
| `logAnalyzer.ts` | (logAnalyzerApi) | `similarSearch`, `similarPeriod`, `getCollectionInfo` |
| `auth.ts` | `api/v1/auth` | `login`, `refresh`, `logout` |

### 3.2 페이지네이션 파라미터 표준

```typescript
// 공통 쿼리 파라미터 타입
export interface PaginationParams {
  limit?: number    // 기본 20
  offset?: number   // 기본 0
}

// alerts 필터
export interface AlertFilterParams extends PaginationParams {
  system_id?: number
  severity?: Severity
  acknowledged?: boolean
  alert_type?: AlertType
}

// analysis 필터
export interface AnalysisFilterParams extends PaginationParams {
  system_id?: number
  severity?: Severity
}
```

### 3.3 API 함수 시그니처 예시

```typescript
// src/api/alerts.ts
export const alertsApi = {
  getAlerts: (params: AlertFilterParams) =>
    adminApi.get('api/v1/alerts', { searchParams: params as Record<string, string | number | boolean> })
      .json<AlertHistory[]>(),

  acknowledgeAlert: (id: number, body: { acknowledged_by: string }) =>
    adminApi.post(`api/v1/alerts/${id}/acknowledge`, { json: body })
      .json<AlertHistory>(),
}
```

---

## 4. React Query 설계

### 4.1 Query Key 팩토리 (`src/constants/queryKeys.ts`)

```typescript
export const qk = {
  // Systems
  systems:      () => ['systems'] as const,
  system:       (id: number) => ['systems', id] as const,
  systemContacts: (id: number) => ['systems', id, 'contacts'] as const,

  // Contacts
  contacts:     () => ['contacts'] as const,
  contact:      (id: number) => ['contacts', id] as const,

  // Alerts
  alerts:       (params: AlertFilterParams) => ['alerts', params] as const,

  // Analysis
  analyses:     (params: AnalysisFilterParams) => ['analyses', params] as const,

  // Aggregations
  aggregations: {
    hourly:   (systemId: number, range?: string) => ['aggregations', 'hourly', systemId, range] as const,
    daily:    (systemId: number) => ['aggregations', 'daily', systemId] as const,
    weekly:   (systemId: number) => ['aggregations', 'weekly', systemId] as const,
    monthly:  (systemId: number, type?: PeriodType) => ['aggregations', 'monthly', systemId, type] as const,
    trends:   () => ['aggregations', 'trends'] as const,
  },

  // Reports
  reports:      (type?: string) => ['reports', type] as const,

  // Collector Config
  collectorConfigs: (systemId?: number) => ['collector-configs', systemId] as const,
  collectorTemplates: (type: string) => ['collector-templates', type] as const,

  // Log Analyzer
  collectionInfo: () => ['collection-info'] as const,
}
```

### 4.2 staleTime 전략

| 데이터 | staleTime | refetchInterval | 이유 |
|---|---|---|---|
| 대시보드 시스템 상태 | 10s | 60s | 실시간성 중요 |
| 알림 피드 | 5s | 30s | 빠른 변화 |
| 시스템 목록 | 60s | 300s | 변화 드문 마스터 데이터 |
| 담당자 목록 | 120s | false | 자주 안 바뀜 |
| 시간 집계 | 3600s | false | 1시간 단위 데이터 |
| 일/주/월 집계 | 86400s | false | 배치 데이터 |
| 트렌드 알림 | 30s | 300s | 장애 예방 우선순위 |

### 4.3 핵심 훅 설계

```typescript
// src/hooks/queries/useSystems.ts
export function useSystems() {
  return useQuery({
    queryKey: qk.systems(),
    queryFn: () => systemsApi.getSystems(),
    staleTime: 60_000,
  })
}

// src/hooks/queries/useAlerts.ts
export function useAlerts(params: AlertFilterParams) {
  return useQuery({
    queryKey: qk.alerts(params),
    queryFn: () => alertsApi.getAlerts(params),
    staleTime: 5_000,
    refetchInterval: 30_000,
  })
}

// src/hooks/mutations/useAcknowledgeAlert.ts
export function useAcknowledgeAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, by }: { id: number; by: string }) =>
      alertsApi.acknowledgeAlert(id, { acknowledged_by: by }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('알림이 확인 처리되었습니다')
    },
  })
}
```

---

## 5. Zustand 스토어 설계

### 5.1 Auth Store (`src/store/authStore.ts`)

```typescript
interface AuthState {
  user: User | null
  token: string | null   // accessToken (메모리만 — XSS 방어)
  login: (resp: LoginResponse) => void
  logout: () => void
  setToken: (token: string) => void  // refresh 후 토큰 갱신용
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: (resp) => set({ user: resp.user, token: resp.access_token }),
      logout: () => set({ user: null, token: null }),
      setToken: (token) => set({ token }),
    }),
    {
      name: 'aoms-auth',
      // token만 sessionStorage에 저장 (탭 닫으면 만료)
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ user: s.user, token: s.token }),
    }
  )
)
```

> **주의**: refreshToken은 httpOnly 쿠키로만 관리. JS에서 접근 불가.

### 5.2 UI Store (`src/store/uiStore.ts`)

```typescript
interface UiState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  criticalCount: number                 // 전역 배너용 미확인 critical 카운트
  setCriticalCount: (n: number) => void
}
```

---

## 6. 컴포넌트 상세 설계

### 6.1 AppLayout + Sidebar

```
AppLayout
├── CriticalBanner (criticalCount > 0 시 고정 상단)
├── Sidebar (240px | 64px collapsed)
│   ├── Logo + collapse toggle
│   ├── CommandPalette trigger (Cmd+K)
│   ├── NavGroup "운영"
│   │   ├── NavItem /dashboard        아이콘: LayoutDashboard
│   │   └── NavItem /trends           아이콘: TrendingUp
│   ├── NavGroup "알림"
│   │   ├── NavItem /alerts           배지: 미확인 카운트
│   │   └── NavItem /feedback         아이콘: MessageSquare
│   ├── NavGroup "분석"
│   │   ├── NavItem /reports          아이콘: BarChart3
│   │   └── NavItem /search           아이콘: Search
│   ├── NavGroup "관리"
│   │   ├── NavItem /systems          아이콘: Server
│   │   ├── NavItem /contacts         아이콘: Users
│   │   └── NavItem /collector-configs 아이콘: Settings
│   └── NavGroup "계정" (하단 고정)
│       ├── NavItem /profile           아이콘: UserCircle
│       ├── NavItem /admin/users       아이콘: ShieldCheck  [admin only]
│       └── NavItem /vector-health     아이콘: Database     [admin only]
└── main (flex-1, overflow-y-auto)
    ├── TopBar (페이지 제목 + 브레드크럼 + 다크모드 토글)
    └── <Outlet />
```

### 6.2 NeuCard Props 인터페이스

```typescript
// src/components/neumorphic/NeuCard.tsx
interface NeuCardProps {
  children: ReactNode
  className?: string
  severity?: 'normal' | 'warning' | 'critical'  // 좌측 border 색상 + 배경 틴트
  pressed?: boolean   // inset shadow (active 상태)
  onClick?: () => void
}
```

### 6.3 DataTable Props 인터페이스

```typescript
// src/components/common/DataTable.tsx
interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  totalCount: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onSort?: (key: keyof T, dir: 'asc' | 'desc') => void
  onRowSelect?: (rows: T[]) => void       // 체크박스 다중 선택
  loading?: boolean
  exportFileName?: string                 // CSV 내보내기 파일명 (없으면 버튼 미노출)
  filterSlot?: ReactNode                  // 필터 UI 슬롯
  emptyState?: ReactNode                  // 커스텀 EmptyState
}
```

### 6.4 CollectorWizard 5단계 스텝

```
Step 1: 수집기 타입 선택
  └── node_exporter | jmx_exporter | db_exporter | custom
      → GET /api/v1/collector-config/templates/{type} 로 기본 metric_group 목록 로드

Step 2: Metric Group 체크리스트
  └── 템플릿 목록 체크박스 + 커스텀 추가 입력

Step 3: Prometheus Job 연결
  └── prometheus_job 입력 (선택), 연결 테스트 버튼

Step 4: 고급 설정 (custom_config JSON editor)
  └── monaco-editor 또는 textarea (폐쇄망: monaco CDN 불가 → textarea)

Step 5: 확인 및 저장
  └── 입력 요약 + POST /api/v1/collector-config
```

### 6.5 SimilarSearchPage 데이터 흐름

```
입력: SimilarSearchInput (자연어 쿼리, 유사도 슬라이더 0.5~1.0)
  └── URL: ?q=쿼리 (useSearchParams 관리)

검색 실행:
  useMutation → POST /aggregation/search
  { query: string, threshold: number, limit: 10 }

결과: SimilarResultCard[]
  ├── 유사도 점수 배지
  ├── 시스템명 + 기간
  ├── LLM 요약 (whitespace-pre-wrap 평문)
  └── 관련 알림 이력 링크 → /alerts?system_id=N
```

### 6.6 MetricChart (DASH-02)

```typescript
interface MetricChartProps {
  aggregations: HourlyAggregation[]
  metricKeys: string[]    // 표시할 메트릭 키 목록
  onPointClick?: (hourBucket: string) => void  // 드릴다운: 알림 탭 이동
}

// 내부 변환: src/lib/metrics-transform.ts
export function transformToChartData(aggregations: HourlyAggregation[]): ChartDataPoint[] {
  return aggregations.map(agg => ({
    timestamp: formatKST(agg.hour_bucket, 'HH:mm'),
    ...JSON.parse(agg.metrics_json) as MetricsPayload,
    llm_severity: agg.llm_severity,
    llm_prediction: agg.llm_prediction,
  }))
}
```

---

## 7. 유틸리티 설계 (`src/lib/utils.ts`)

```typescript
// KST 변환 (UTC → UTC+9)
export function formatKST(
  utcDate: string | Date,
  format: 'datetime' | 'date' | 'HH:mm' = 'datetime'
): string

// 상대 시간 (1시간 이내: "3분 전", 이상: KST 절대)
export function formatRelative(utcDate: string): string

// severity → 색상 클래스
export function severityColor(severity: Severity | LlmSeverity): string

// anomaly_type → 배지 색상
export function anomalyColor(type: AnomalyType): string

// cn (shadcn 표준)
export { cn } from '@/lib/cn'
```

---

## 8. 인증 플로우 설계

### 8.1 로그인 시퀀스

```
브라우저                       admin-api
   │── POST /api/v1/auth/login ──▶│
   │   { email, password }        │ DB 검증
   │◀── 200 OK ──────────────────│
   │   { access_token, user }     │ Set-Cookie: refresh_token=xxx; HttpOnly; SameSite=strict
   │
   zustand: login({ access_token, user })
   sessionStorage 저장 (탭 닫으면 만료)
```

### 8.2 토큰 갱신 시퀀스

```
ky beforeRequest:
  ├── token 있음 → Authorization: Bearer {token} 주입
  └── (token 만료는 401로 감지)

ky afterResponse (401 수신):
  ├── POST /api/v1/auth/refresh  (쿠키 자동 전송)
  │   ├── 성공: 새 access_token → setToken() → 원 요청 재시도
  │   └── 실패: logout() + navigate('/login')
```

### 8.3 백엔드 선행 구현 목록 (프론트 Phase 1 전 필수)

| # | 엔드포인트 | 파일 | 내용 |
|---|---|---|---|
| 1 | `POST /api/v1/auth/login` | `routes/auth.py` (신규) | bcrypt 검증 → accessToken(15분) + refreshToken 쿠키(7일) |
| 2 | `POST /api/v1/auth/refresh` | `routes/auth.py` | refresh 쿠키 검증 → 새 accessToken |
| 3 | `POST /api/v1/auth/logout` | `routes/auth.py` | refresh 쿠키 삭제 |
| 4 | `require_admin` Dependency | `routes/auth.py` | JWT role 체크 (백엔드 권한 강제) |
| 5 | CORS 특정 origin으로 변경 | `main.py:27` | `allow_origins=[...]`, `allow_credentials=True` |
| 6 | `GET /api/v1/alerts` offset 추가 | `routes/alerts.py` | 서버사이드 페이지네이션 |
| 7 | `GET /api/v1/analysis` offset 추가 | `routes/analysis.py` | 서버사이드 페이지네이션 |
| 8 | `contacts.llm_api_key` 마스킹 | `schemas.py:ContactOut` | `sk-abc***` 형태 반환 |

---

## 9. 뉴모피즘 접근성 설계 (WCAG AA)

### 9.1 NeuInput 필수 테두리

```tsx
// 그림자만으로 경계 표시 금지 — border 반드시 포함
<input className="
  rounded-xl bg-[#E8EBF0]
  border border-[#C0C4CF]               ← 필수
  shadow-[inset_4px_4px_8px_#C8CBD4,inset_-4px_-4px_8px_#FFFFFF]
  focus:outline-none
  focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2  ← 키보드 탐색
  px-4 py-2 text-[#1A1F2E]
" />
```

### 9.2 보조 텍스트 색상 조정

```
기존 계획: text-[#5A6072] (배경 #E8EBF0 대비 3.4:1 — WCAG AA 미달)
수정:      text-[#4A5568] (대비 4.6:1 — WCAG AA 통과)
```

### 9.3 Critical 알림 시각 계층

```css
/* severity === 'critical' 카드 */
border-l-4 border-l-[#DC2626] bg-[rgba(220,38,38,0.04)]

/* severity === 'warning' 카드 */
border-l-4 border-l-[#D97706]
```

---

## 10. 에러/로딩 상태 패턴

| 상황 | 컴포넌트 | 비고 |
|---|---|---|
| 페이지 첫 로드 | `<LoadingSkeleton shape="card\|table" />` | shape별 뼈대 |
| 버튼 액션 중 | `<Loader2 className="animate-spin" />` + `disabled` | isPending 연동 |
| API 에러 500/503 | `<ErrorCard onRetry={refetch} />` | ErrorBoundary로 감쌈 |
| 네트워크 끊김 | 상단 노란 배너 (OfflineBanner) | navigator.onLine 이벤트 |
| 데이터 0건 | `<EmptyState icon title description cta />` | 화면별 맞춤 props |
| 유효성 에러 422 | 필드별 inline 에러 (react-hook-form + zod) | `detail[].loc` 기반 |

### EmptyState Props

```typescript
interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  cta?: { label: string; onClick: () => void }
}

// 사용 예
<EmptyState
  icon={<Server className="w-12 h-12 text-[#4A5568]" />}
  title="등록된 시스템이 없습니다"
  description="먼저 모니터링 대상 시스템을 등록해주세요."
  cta={{ label: '시스템 등록', onClick: () => navigate('/systems/new') }}
/>
```

---

## 11. nginx 설계 (`services/frontend/nginx.conf`)

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    server_tokens off;

    # 보안 헤더
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none';" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # SPA 폴백
    location / {
        try_files $uri $uri/ /index.html;
    }

    # health check
    location /health {
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    # API 프록시
    location /api/ {
        proxy_pass http://admin-api:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /analyze/ {
        proxy_pass http://log-analyzer:8000;
        proxy_set_header Host $host;
    }

    location /aggregation/ {
        proxy_pass http://log-analyzer:8000;
        proxy_set_header Host $host;
    }
}
```

---

## 12. Dockerfile 설계

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:1.27-alpine
COPY --from=builder /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
USER nginx

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -q --spider http://localhost/health || exit 1

EXPOSE 80
```

`.dockerignore`:
```
node_modules
dist
.env.local
.env*.local
*.log
```

---

## 13. 구현 순서 (Phase별 체크리스트)

### Phase 0 — 백엔드 선행 (프론트 시작 전)
- [ ] admin-api `routes/auth.py` 신규 (login/refresh/logout)
- [ ] CORS `allow_origins` 특정 도메인으로 제한
- [ ] alerts/analysis GET에 `offset` 파라미터 추가
- [ ] `contacts.llm_api_key` 마스킹 처리

### Phase 1 — Scaffold + 핵심 운영
- [ ] Vite + React 18 + Tailwind v4 + shadcn 초기화
- [ ] Pretendard 폰트 + CSS 토큰 설정
- [ ] AppLayout (Sidebar collapse + TopBar)
- [ ] ky 클라이언트 + react-query + zustand
- [ ] AuthGuard + 로그인 페이지 (AUTH-01)
- [ ] DASH-01 운영 대시보드
- [ ] SYS-01/02 시스템 관리
- [ ] ALT-01 알림 이력

### Phase 2 — 확장
- [ ] CNT-01/02 담당자 관리
- [ ] DASH-02 시스템 상세 (recharts MetricChart)
- [ ] RPT-01 안정성 리포트 (기간 토글)
- [ ] RPT-02 리포트 발송 이력

### Phase 3 — 고급
- [ ] SIM-01 유사 장애 검색
- [ ] TREND-01 트렌드 예측 알림
- [ ] SYS-03 수집기 마법사
- [ ] AUTH-02/03 회원가입 + 승인
- [ ] FEED-01, COL-01, VEC-01, PROFILE
- [ ] CommandPalette (Cmd+K)
- [ ] 다크 모드 토글

---

## 14. 검증 체크리스트 (완료 기준)

- [ ] `npm audit --audit-level=high` 경고 없음
- [ ] Lighthouse Accessibility 90점 이상
- [ ] WCAG AA: 보조 텍스트 `#4A5568` 대비 4.6:1 확인
- [ ] Focus ring: 키보드 탭 이동 시 파란 outline 가시
- [ ] 401 → 자동 토큰 갱신 또는 /login 리다이렉트
- [ ] refreshToken: DevTools Application → Cookies에서 HttpOnly 확인
- [ ] LLM 텍스트: `whitespace-pre-wrap` 평문 렌더링 (dangerouslySetInnerHTML 사용 금지)
- [ ] CSP 헤더: `default-src 'self'` 확인
- [ ] Critical 알림 시 전역 배너 노출 (어느 페이지에서도)
- [ ] 대시보드 1분 자동 갱신 (Network 탭 확인)
- [ ] `npm run build` 빌드 오류 없음
