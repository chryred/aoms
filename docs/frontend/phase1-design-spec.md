# Synapse-V Frontend — Phase 1 상세 설계 명세서

> `frontend-design-spec.md` + `frontend-plan.md` 기반. Phase 1 구현 계약서.
> 구현 전 반드시 이 문서를 전체 숙지할 것.

---

## 0. 전제 조건 (Phase 0 완료 확인)

Phase 1 시작 전 admin-api에서 아래 항목이 완료되어 있어야 한다.

| 항목 | 파일 | 확인 방법 |
|---|---|---|
| `POST /api/v1/auth/login` | `routes/auth.py` | `curl -X POST .../login -d '{"email":"...","password":"..."}'` |
| `POST /api/v1/auth/refresh` | `routes/auth.py` | 응답 쿠키에 `refresh_token` HttpOnly 확인 |
| `POST /api/v1/auth/logout` | `routes/auth.py` | 204 반환 |
| `GET /api/v1/auth/me` | `routes/auth.py` | Bearer 토큰으로 현재 사용자 반환 |
| CORS `allow_origins` | `main.py` | `CORS_ORIGINS` 환경변수로 특정 도메인만 허용 |
| alerts `offset` 파라미터 | `routes/alerts.py` | `GET /api/v1/alerts?offset=20` |
| `contacts.llm_api_key` 마스킹 | `schemas.py` | `sk-abc***` 형태 반환 |

> ✅ 현재 코드베이스에서 Phase 0 항목은 이미 구현되어 있음 (`auth.py`, `routes/auth.py` 신규 파일 확인).

---

## 1. 프로젝트 스캐폴드

### 1.1 디렉토리 위치

```
main-server/services/frontend/   ← 여기에 Vite 프로젝트 생성
```

### 1.2 초기화 명령어 (순서 엄수)

```bash
cd main-server/services

# 1. Vite + React + TypeScript 스캐폴드
npm create vite@latest frontend -- --template react-ts
cd frontend

# 2. React 18 핀 고정 (React 19 RSC CVE 회피)
npm install react@18.3.1 react-dom@18.3.1

# 3. TypeScript 타입
npm install --save-dev @types/react@18.3.1 @types/react-dom@18.3.1

# 4. Tailwind CSS v4 (postcss 불필요)
npm install tailwindcss@4.1.4 @tailwindcss/vite@4.1.4

# 5. shadcn/ui 초기화
npx shadcn@latest init -t vite

# 6. 라우터
npm install react-router-dom@7.5.3

# 7. 상태 관리 & 데이터 패칭
npm install @tanstack/react-query@5.90.3 @tanstack/react-query-devtools@5.90.3
npm install zustand@5.0.3

# 8. HTTP 클라이언트
npm install ky@1.7.2

# 9. 차트 & UI
npm install recharts@2.15.3
npm install react-hot-toast@2.5.2
npm install lucide-react

# 10. 개발 도구
npm install --save-dev @types/node prettier prettier-plugin-tailwindcss

# 11. 보안 감사 (결과 0이어야 함)
npm audit --audit-level=high
```

### 1.3 최종 프로젝트 구조

```
main-server/services/frontend/
├── public/
│   └── fonts/
│       ├── Pretendard-Regular.woff2
│       ├── Pretendard-Medium.woff2
│       ├── Pretendard-SemiBold.woff2
│       └── Pretendard-Bold.woff2
├── src/
│   ├── lib/
│   │   ├── ky-client.ts          # adminApi / logAnalyzerApi
│   │   ├── queryClient.ts        # React Query 전역 설정
│   │   └── utils.ts              # cn, formatKST, formatRelative, severityColor
│   ├── constants/
│   │   ├── queryKeys.ts          # qk 팩토리
│   │   └── routes.ts             # ROUTES 상수
│   ├── types/
│   │   ├── system.ts
│   │   ├── contact.ts
│   │   ├── alert.ts
│   │   └── auth.ts
│   ├── api/
│   │   ├── systems.ts
│   │   ├── alerts.ts
│   │   └── auth.ts
│   ├── store/
│   │   ├── authStore.ts
│   │   └── uiStore.ts
│   ├── hooks/
│   │   ├── queries/
│   │   │   ├── useSystems.ts
│   │   │   └── useAlerts.ts
│   │   └── mutations/
│   │       ├── useCreateSystem.ts
│   │       ├── useUpdateSystem.ts
│   │       ├── useDeleteSystem.ts
│   │       └── useAcknowledgeAlert.ts
│   ├── components/
│   │   ├── ui/                   # shadcn 복사본 (손대지 않음)
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   ├── AuthLayout.tsx
│   │   │   ├── AuthGuard.tsx
│   │   │   └── AdminGuard.tsx
│   │   ├── neumorphic/
│   │   │   ├── NeuCard.tsx
│   │   │   ├── NeuButton.tsx
│   │   │   ├── NeuInput.tsx
│   │   │   └── NeuBadge.tsx
│   │   ├── common/
│   │   │   ├── DataTable.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   ├── LoadingSkeleton.tsx
│   │   │   ├── ErrorCard.tsx
│   │   │   ├── PageHeader.tsx
│   │   │   └── CriticalBanner.tsx
│   │   ├── dashboard/
│   │   │   ├── SystemStatusGrid.tsx
│   │   │   ├── SystemStatusCard.tsx
│   │   │   └── AlertFeed.tsx
│   │   ├── system/
│   │   │   ├── SystemTable.tsx
│   │   │   └── SystemFormDrawer.tsx
│   │   └── alert/
│   │       ├── AlertTable.tsx
│   │       ├── AlertDetailPanel.tsx
│   │       └── AnomalyTypeBadge.tsx
│   ├── pages/
│   │   ├── auth/
│   │   │   └── LoginPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── system/
│   │   │   └── SystemListPage.tsx
│   │   └── AlertHistoryPage.tsx
│   ├── App.tsx                   # 라우트 트리
│   └── main.tsx                  # QueryClientProvider, Toaster
├── .env.local                    # VITE_ADMIN_API_URL (gitignore)
├── .env.example
├── components.json               # shadcn 설정
├── vite.config.ts
├── tsconfig.json
├── package.json                  # ^ 없이 정확한 버전 고정
├── Dockerfile
└── nginx.conf
```

---

## 2. 핵심 설정 파일

### 2.1 `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/analyze': 'http://localhost:8000',
      '/aggregation': 'http://localhost:8000',
    },
  },
})
```

### 2.2 `src/index.css` (Tailwind v4 + 뉴모피즘 토큰)

```css
@import "tailwindcss";

@font-face {
  font-family: 'Pretendard';
  font-weight: 400;
  src: url('/fonts/Pretendard-Regular.woff2') format('woff2');
}
@font-face {
  font-family: 'Pretendard';
  font-weight: 500;
  src: url('/fonts/Pretendard-Medium.woff2') format('woff2');
}
@font-face {
  font-family: 'Pretendard';
  font-weight: 600;
  src: url('/fonts/Pretendard-SemiBold.woff2') format('woff2');
}
@font-face {
  font-family: 'Pretendard';
  font-weight: 700;
  src: url('/fonts/Pretendard-Bold.woff2') format('woff2');
}

@theme inline {
  --font-sans: 'Pretendard', system-ui, sans-serif;

  /* 뉴모피즘 그림자 토큰 */
  --shadow-neu-flat:    6px 6px 12px #C8CBD4, -6px -6px 12px #FFFFFF;
  --shadow-neu-inset:   inset 4px 4px 8px #C8CBD4, inset -4px -4px 8px #FFFFFF;
  --shadow-neu-pressed: inset 2px 2px 6px #C8CBD4, inset -2px -2px 6px #FFFFFF;

  /* 색상 팔레트 */
  --color-bg-base:        #E8EBF0;
  --color-surface:        #E8EBF0;
  --color-accent:         #6366F1;
  --color-accent-hover:   #4F46E5;
  --color-accent-muted:   #EEF2FF;
  --color-text-primary:   #1A1F2E;
  --color-text-secondary: #4A5568;  /* WCAG AA 4.6:1 대비 확보 */
  --color-critical:       #DC2626;
  --color-warning:        #D97706;
  --color-normal:         #16A34A;
  --color-glass-bg:       rgba(99, 102, 241, 0.10);
  --color-glass-border:   rgba(99, 102, 241, 0.20);
}

body {
  background-color: #E8EBF0;
  font-family: 'Pretendard', system-ui, sans-serif;
  color: #1A1F2E;
  -webkit-font-smoothing: antialiased;
}
```

### 2.3 `.env.example`

```
VITE_ADMIN_API_URL=http://localhost:8080
VITE_LOG_ANALYZER_URL=http://localhost:8000
```

> 운영 배포 시 `.env.production`에서 nginx 프록시 경로(`/api`, `/analyze`)로 교체.

---

## 3. 기반 레이어 구현

### 3.1 `src/lib/ky-client.ts`

```ts
import ky from 'ky'
import { useAuthStore } from '@/store/authStore'

// 401 처리: refresh 시도 → 실패 시 logout + /login 리다이렉트
async function handle401(request: Request, _options: unknown, response: Response) {
  if (response.status !== 401) return

  // refresh 시도
  try {
    const refreshResp = await ky.post(
      `${import.meta.env.VITE_ADMIN_API_URL ?? ''}/api/v1/auth/refresh`,
      { credentials: 'include' }
    ).json<{ access_token: string }>()

    useAuthStore.getState().setToken(refreshResp.access_token)
    // 원 요청 재시도 (새 토큰 주입)
    request.headers.set('Authorization', `Bearer ${refreshResp.access_token}`)
    return ky(request)
  } catch {
    useAuthStore.getState().logout()
    window.location.href = '/login'
  }
}

export const adminApi = ky.create({
  prefixUrl: import.meta.env.VITE_ADMIN_API_URL ?? '',
  credentials: 'include',   // refreshToken 쿠키 자동 전송
  timeout: 10_000,
  hooks: {
    beforeRequest: [
      (request) => {
        const token = useAuthStore.getState().token
        if (token) request.headers.set('Authorization', `Bearer ${token}`)
      },
    ],
    afterResponse: [handle401],
  },
})

export const logAnalyzerApi = ky.create({
  prefixUrl: import.meta.env.VITE_LOG_ANALYZER_URL ?? '',
  credentials: 'include',
  timeout: 15_000,
  hooks: {
    beforeRequest: [
      (request) => {
        const token = useAuthStore.getState().token
        if (token) request.headers.set('Authorization', `Bearer ${token}`)
      },
    ],
    afterResponse: [handle401],
  },
})
```

### 3.2 `src/lib/queryClient.ts`

```ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 300_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
```

### 3.3 `src/lib/utils.ts`

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Severity, AnomalyType } from '@/types/alert'
import type { LlmSeverity } from '@/types/aggregation'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// KST 변환 (UTC → UTC+9)
export function formatKST(
  utcDate: string | Date,
  format: 'datetime' | 'date' | 'HH:mm' = 'datetime'
): string {
  const d = new Date(utcDate)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)

  if (format === 'HH:mm') {
    return kst.toISOString().slice(11, 16)
  }
  if (format === 'date') {
    return kst.toISOString().slice(0, 10)
  }
  return kst.toISOString().slice(0, 16).replace('T', ' ')
}

// 상대 시간 (1시간 이내: "3분 전", 이상: KST 절대)
export function formatRelative(utcDate: string): string {
  const diff = Date.now() - new Date(utcDate).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return '방금 전'
  if (mins < 60) return `${mins}분 전`
  return formatKST(utcDate, 'datetime')
}

// severity → Tailwind 텍스트 색상 클래스
export function severityColor(severity: Severity | LlmSeverity): string {
  switch (severity) {
    case 'critical': return 'text-[#DC2626]'
    case 'warning':  return 'text-[#D97706]'
    default:         return 'text-[#16A34A]'
  }
}

// anomaly_type → 배지 색상 클래스
export function anomalyColor(type: AnomalyType): string {
  switch (type) {
    case 'duplicate':  return 'bg-gray-100 text-gray-600'
    case 'recurring':  return 'bg-red-100 text-red-700'
    case 'related':    return 'bg-yellow-100 text-yellow-700'
    default:           return 'bg-blue-100 text-blue-700'
  }
}
```

### 3.4 `src/constants/queryKeys.ts`

```ts
import type { AlertFilterParams } from '@/api/alerts'

export const qk = {
  systems:        () => ['systems'] as const,
  system:         (id: number) => ['systems', id] as const,
  systemContacts: (id: number) => ['systems', id, 'contacts'] as const,
  alerts:         (params: AlertFilterParams) => ['alerts', params] as const,
  me:             () => ['auth', 'me'] as const,
}
```

### 3.5 `src/constants/routes.ts`

```ts
export const ROUTES = {
  LOGIN:      '/login',
  DASHBOARD:  '/dashboard',
  SYSTEMS:    '/systems',
  SYSTEM_NEW: '/systems/new',
  SYSTEM_EDIT: (id: number) => `/systems/${id}/edit`,
  ALERTS:     '/alerts',
} as const
```

---

## 4. 타입 정의 (`src/types/`)

### 4.1 `src/types/auth.ts`

```ts
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
```

### 4.2 `src/types/system.ts` (design-spec §2.1 그대로)

```ts
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
  created_at: string
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

### 4.3 `src/types/alert.ts` (Phase 1 필요 항목만)

```ts
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
  acknowledged_at: string | null
  acknowledged_by: string | null
  escalated: boolean
  anomaly_type: AnomalyType | null
  similarity_score: number | null
  qdrant_point_id: string | null
  created_at: string
}
```

---

## 5. Zustand 스토어

### 5.1 `src/store/authStore.ts`

```ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User, LoginResponse } from '@/types/auth'

interface AuthState {
  user: User | null
  token: string | null
  login: (resp: LoginResponse) => void
  logout: () => void
  setToken: (token: string) => void
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
      storage: createJSONStorage(() => sessionStorage), // 탭 닫으면 만료
      partialize: (s) => ({ user: s.user, token: s.token }),
    }
  )
)
```

### 5.2 `src/store/uiStore.ts`

```ts
import { create } from 'zustand'

interface UiState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  criticalCount: number
  setCriticalCount: (n: number) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  criticalCount: 0,
  setCriticalCount: (n) => set({ criticalCount: n }),
}))
```

---

## 6. API 레이어 (`src/api/`)

### 6.1 `src/api/auth.ts`

```ts
import { adminApi } from '@/lib/ky-client'
import type { LoginRequest, LoginResponse, User } from '@/types/auth'

export const authApi = {
  login: (body: LoginRequest) =>
    adminApi.post('api/v1/auth/login', { json: body }).json<LoginResponse>(),

  refresh: () =>
    adminApi.post('api/v1/auth/refresh').json<{ access_token: string }>(),

  logout: () =>
    adminApi.post('api/v1/auth/logout'),

  me: () =>
    adminApi.get('api/v1/auth/me').json<User>(),
}
```

### 6.2 `src/api/systems.ts`

```ts
import { adminApi } from '@/lib/ky-client'
import type { System, SystemCreate, SystemUpdate } from '@/types/system'

export const systemsApi = {
  getSystems: () =>
    adminApi.get('api/v1/systems').json<System[]>(),

  getSystem: (id: number) =>
    adminApi.get(`api/v1/systems/${id}`).json<System>(),

  createSystem: (body: SystemCreate) =>
    adminApi.post('api/v1/systems', { json: body }).json<System>(),

  updateSystem: (id: number, body: SystemUpdate) =>
    adminApi.patch(`api/v1/systems/${id}`, { json: body }).json<System>(),

  deleteSystem: (id: number) =>
    adminApi.delete(`api/v1/systems/${id}`),
}
```

### 6.3 `src/api/alerts.ts`

```ts
import { adminApi } from '@/lib/ky-client'
import type { AlertHistory } from '@/types/alert'
import type { Severity, AlertType } from '@/types/alert'

export interface AlertFilterParams {
  system_id?: number
  severity?: Severity
  alert_type?: AlertType
  acknowledged?: boolean
  limit?: number
  offset?: number
}

export const alertsApi = {
  getAlerts: (params: AlertFilterParams = {}) =>
    adminApi.get('api/v1/alerts', {
      searchParams: Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined)
      ) as Record<string, string | number | boolean>,
    }).json<AlertHistory[]>(),

  acknowledgeAlert: (id: number, body: { acknowledged_by: string }) =>
    adminApi.post(`api/v1/alerts/${id}/acknowledge`, { json: body }).json<AlertHistory>(),
}
```

---

## 7. React Query 훅

### 7.1 `src/hooks/queries/useSystems.ts`

```ts
import { useQuery } from '@tanstack/react-query'
import { systemsApi } from '@/api/systems'
import { qk } from '@/constants/queryKeys'

export function useSystems() {
  return useQuery({
    queryKey: qk.systems(),
    queryFn: systemsApi.getSystems,
    staleTime: 60_000,
    refetchInterval: 300_000,
  })
}
```

### 7.2 `src/hooks/queries/useAlerts.ts`

```ts
import { useQuery } from '@tanstack/react-query'
import { alertsApi, type AlertFilterParams } from '@/api/alerts'
import { qk } from '@/constants/queryKeys'

export function useAlerts(params: AlertFilterParams = {}) {
  return useQuery({
    queryKey: qk.alerts(params),
    queryFn: () => alertsApi.getAlerts(params),
    staleTime: 5_000,
    refetchInterval: 30_000,
  })
}
```

### 7.3 `src/hooks/mutations/useCreateSystem.ts`

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { systemsApi } from '@/api/systems'
import { qk } from '@/constants/queryKeys'
import toast from 'react-hot-toast'
import type { SystemCreate } from '@/types/system'

export function useCreateSystem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SystemCreate) => systemsApi.createSystem(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.systems() })
      toast.success('시스템이 등록되었습니다')
    },
    onError: () => toast.error('시스템 등록에 실패했습니다'),
  })
}
```

### 7.4 `src/hooks/mutations/useUpdateSystem.ts`

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { systemsApi } from '@/api/systems'
import { qk } from '@/constants/queryKeys'
import toast from 'react-hot-toast'
import type { SystemUpdate } from '@/types/system'

export function useUpdateSystem(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SystemUpdate) => systemsApi.updateSystem(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.systems() })
      qc.invalidateQueries({ queryKey: qk.system(id) })
      toast.success('시스템이 수정되었습니다')
    },
    onError: () => toast.error('시스템 수정에 실패했습니다'),
  })
}
```

### 7.5 `src/hooks/mutations/useDeleteSystem.ts`

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { systemsApi } from '@/api/systems'
import { qk } from '@/constants/queryKeys'
import toast from 'react-hot-toast'

export function useDeleteSystem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => systemsApi.deleteSystem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.systems() })
      toast.success('시스템이 삭제되었습니다')
    },
    onError: () => toast.error('시스템 삭제에 실패했습니다'),
  })
}
```

### 7.6 `src/hooks/mutations/useAcknowledgeAlert.ts`

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { alertsApi } from '@/api/alerts'
import toast from 'react-hot-toast'

export function useAcknowledgeAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, by }: { id: number; by: string }) =>
      alertsApi.acknowledgeAlert(id, { acknowledged_by: by }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('알림이 확인 처리되었습니다')
    },
    onError: () => toast.error('처리 중 오류가 발생했습니다'),
  })
}
```

---

## 8. 공통 컴포넌트

### 8.1 뉴모피즘 프리미티브

#### `src/components/neumorphic/NeuCard.tsx`

```tsx
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface NeuCardProps {
  children: ReactNode
  className?: string
  severity?: 'normal' | 'warning' | 'critical'
  pressed?: boolean
  onClick?: () => void
}

export function NeuCard({ children, className, severity, pressed, onClick }: NeuCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-2xl bg-[#E8EBF0] p-6 transition-shadow',
        pressed
          ? 'shadow-[inset_4px_4px_8px_#C8CBD4,inset_-4px_-4px_8px_#FFFFFF]'
          : 'shadow-[6px_6px_12px_#C8CBD4,-6px_-6px_12px_#FFFFFF]',
        severity === 'critical' && 'border-l-4 border-l-[#DC2626] bg-[rgba(220,38,38,0.04)]',
        severity === 'warning'  && 'border-l-4 border-l-[#D97706]',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  )
}
```

#### `src/components/neumorphic/NeuButton.tsx`

```tsx
import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

interface NeuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'glass' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export function NeuButton({
  children, variant = 'primary', size = 'md', loading, className, disabled, ...props
}: NeuButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all',
        'focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-6 py-3 text-base',
        variant === 'primary' && [
          'bg-[#6366F1] text-white',
          'shadow-[3px_3px_6px_#C8CBD4,-3px_-3px_6px_#FFFFFF]',
          'hover:bg-[#4F46E5] active:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.2)]',
        ],
        variant === 'glass' && [
          'bg-[rgba(99,102,241,0.10)] text-[#6366F1]',
          'border border-[rgba(99,102,241,0.20)]',
          'backdrop-blur-sm hover:bg-[rgba(99,102,241,0.18)]',
        ],
        variant === 'ghost' && [
          'text-[#4A5568] hover:bg-[rgba(0,0,0,0.05)]',
        ],
        (disabled || loading) && 'opacity-50 cursor-not-allowed',
        className
      )}
      {...props}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  )
}
```

#### `src/components/neumorphic/NeuInput.tsx`

```tsx
import { cn } from '@/lib/utils'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { forwardRef } from 'react'

interface NeuInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  leftIcon?: ReactNode
}

export const NeuInput = forwardRef<HTMLInputElement, NeuInputProps>(
  ({ label, error, leftIcon, className, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-[#1A1F2E]">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A5568]">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            className={cn(
              'w-full rounded-xl bg-[#E8EBF0]',
              'border border-[#C0C4CF]',                       // WCAG 필수 테두리
              'shadow-[inset_4px_4px_8px_#C8CBD4,inset_-4px_-4px_8px_#FFFFFF]',
              'px-4 py-2.5 text-[#1A1F2E] placeholder:text-[#4A5568]',
              'focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2',
              leftIcon && 'pl-10',
              error && 'border-[#DC2626] focus:ring-[#DC2626]',
              className
            )}
            {...props}
          />
        </div>
        {error && <p className="text-xs text-[#DC2626]">{error}</p>}
      </div>
    )
  }
)
NeuInput.displayName = 'NeuInput'
```

#### `src/components/neumorphic/NeuBadge.tsx`

```tsx
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

type BadgeVariant = 'critical' | 'warning' | 'normal' | 'info' | 'muted'

interface NeuBadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantMap: Record<BadgeVariant, string> = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  warning:  'bg-yellow-100 text-yellow-700 border border-yellow-200',
  normal:   'bg-green-100 text-green-700 border border-green-200',
  info:     'bg-blue-100 text-blue-700 border border-blue-200',
  muted:    'bg-gray-100 text-gray-600 border border-gray-200',
}

export function NeuBadge({ children, variant = 'muted', className }: NeuBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      variantMap[variant],
      className
    )}>
      {children}
    </span>
  )
}
```

### 8.2 공통 레이아웃

#### `src/components/common/EmptyState.tsx`

```tsx
import type { ReactNode } from 'react'
import { NeuButton } from '@/components/neumorphic/NeuButton'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  cta?: { label: string; onClick: () => void }
}

export function EmptyState({ icon, title, description, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="text-[#4A5568]">{icon}</div>
      <div>
        <p className="text-lg font-semibold text-[#1A1F2E]">{title}</p>
        {description && (
          <p className="mt-1 text-sm text-[#4A5568]">{description}</p>
        )}
      </div>
      {cta && (
        <NeuButton onClick={cta.onClick}>{cta.label}</NeuButton>
      )}
    </div>
  )
}
```

#### `src/components/common/LoadingSkeleton.tsx`

```tsx
import { cn } from '@/lib/utils'

interface LoadingSkeletonProps {
  shape?: 'card' | 'table' | 'text'
  count?: number
  className?: string
}

function SkeletonBox({ className }: { className?: string }) {
  return (
    <div className={cn(
      'animate-pulse rounded-xl bg-[#D4D7DE]',
      className
    )} />
  )
}

export function LoadingSkeleton({ shape = 'card', count = 3, className }: LoadingSkeletonProps) {
  if (shape === 'table') {
    return (
      <div className={cn('space-y-3', className)}>
        <SkeletonBox className="h-10 w-full" />
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonBox key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }
  return (
    <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBox key={i} className="h-40 w-full" />
      ))}
    </div>
  )
}
```

#### `src/components/common/ErrorCard.tsx`

```tsx
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { AlertCircle } from 'lucide-react'

interface ErrorCardProps {
  message?: string
  onRetry?: () => void
}

export function ErrorCard({ message = '데이터를 불러오지 못했습니다', onRetry }: ErrorCardProps) {
  return (
    <NeuCard className="flex flex-col items-center gap-4 py-12 text-center">
      <AlertCircle className="w-12 h-12 text-[#DC2626]" />
      <p className="text-[#4A5568]">{message}</p>
      {onRetry && (
        <NeuButton variant="ghost" onClick={onRetry}>다시 시도</NeuButton>
      )}
    </NeuCard>
  )
}
```

#### `src/components/common/PageHeader.tsx`

```tsx
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  action?: ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1A1F2E]">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-[#4A5568]">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
```

#### `src/components/common/CriticalBanner.tsx`

```tsx
import { useUiStore } from '@/store/uiStore'
import { AlertTriangle } from 'lucide-react'

export function CriticalBanner() {
  const count = useUiStore((s) => s.criticalCount)
  if (count === 0) return null

  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-2
                 bg-[#DC2626] py-2 px-4 text-white text-sm font-medium"
    >
      <AlertTriangle className="w-4 h-4" />
      미확인 Critical 알림 {count}건 — 즉시 확인이 필요합니다
    </div>
  )
}
```

---

## 9. 레이아웃 컴포넌트

### 9.1 `src/components/layout/AuthGuard.tsx`

```tsx
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import type { ReactNode } from 'react'

export function AuthGuard({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

### 9.2 `src/components/layout/AdminGuard.tsx`

```tsx
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'
import type { ReactNode } from 'react'

export function AdminGuard({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  if (user?.role !== 'admin') {
    toast.error('관리자 권한이 필요합니다')
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}
```

### 9.3 `src/components/layout/Sidebar.tsx`

```tsx
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Bell, Server, Users, Settings,
  TrendingUp, BarChart3, Search, MessageSquare,
  UserCircle, ShieldCheck, Database, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useAlerts } from '@/hooks/queries/useAlerts'
import { cn } from '@/lib/utils'

interface NavItemProps {
  to: string
  icon: React.ReactNode
  label: string
  badge?: number
  collapsed: boolean
}

function NavItem({ to, icon, label, badge, collapsed }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
        'focus:outline-none focus:ring-2 focus:ring-[#6366F1]',
        isActive
          ? 'bg-[#6366F1] text-white shadow-[3px_3px_6px_#C8CBD4,-3px_-3px_6px_#FFFFFF]'
          : 'text-[#4A5568] hover:bg-[rgba(99,102,241,0.08)]',
        collapsed && 'justify-center px-2'
      )}
      title={collapsed ? label : undefined}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="ml-auto rounded-full bg-[#DC2626] px-1.5 py-0.5 text-xs text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  )
}

function NavGroup({ label, collapsed, children }: {
  label: string; collapsed: boolean; children: React.ReactNode
}) {
  return (
    <div className="mb-2">
      {!collapsed && (
        <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-[#4A5568]">
          {label}
        </p>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  // 미확인 알림 카운트
  const { data: unacknowledgedAlerts } = useAlerts({ acknowledged: false, limit: 1 })
  const unackCount = unacknowledgedAlerts?.length ?? 0

  const w = collapsed ? 'w-16' : 'w-60'

  return (
    <aside className={cn(
      'flex flex-col h-full bg-[#E8EBF0] border-r border-[#D4D7DE] transition-all duration-200',
      w
    )}>
      {/* 로고 + 토글 */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[#D4D7DE]">
        {!collapsed && (
          <span className="text-lg font-bold text-[#1A1F2E] tracking-tight">Synapse-V</span>
        )}
        <button
          onClick={toggleSidebar}
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          className="rounded-lg p-1.5 text-[#4A5568] hover:bg-[rgba(0,0,0,0.05)]
                     focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
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

      {/* 계정 (하단 고정) */}
      <div className="border-t border-[#D4D7DE] px-2 py-3 space-y-0.5">
        <NavItem to="/profile" icon={<UserCircle className="w-4 h-4" />} label="내 프로필" collapsed={collapsed} />
        {user?.role === 'admin' && (
          <>
            <NavItem to="/admin/users" icon={<ShieldCheck className="w-4 h-4" />} label="사용자 관리" collapsed={collapsed} />
            <NavItem to="/vector-health" icon={<Database className="w-4 h-4" />} label="벡터 상태" collapsed={collapsed} />
          </>
        )}
      </div>
    </aside>
  )
}
```

### 9.4 `src/components/layout/TopBar.tsx`

```tsx
import { useLocation } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { authApi } from '@/api/auth'
import toast from 'react-hot-toast'

// 경로 → 제목 매핑
const PAGE_TITLES: Record<string, string> = {
  '/dashboard':         '운영 대시보드',
  '/alerts':            '알림 이력',
  '/systems':           '시스템 관리',
  '/contacts':          '담당자 관리',
  '/reports':           '안정성 리포트',
  '/search':            '유사 장애 검색',
  '/trends':            '트렌드 예측',
  '/feedback':          '피드백 관리',
  '/collector-configs': '수집기 설정',
  '/vector-health':     '벡터 컬렉션 상태',
  '/profile':           '내 프로필',
  '/admin/users':       '사용자 관리',
}

export function TopBar() {
  const { pathname } = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  // 동적 경로 처리: /systems/1/edit → /systems
  const baseKey = '/' + pathname.split('/')[1]
  const title = PAGE_TITLES[pathname] ?? PAGE_TITLES[baseKey] ?? 'Synapse-V'

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } finally {
      logout()
      window.location.href = '/login'
    }
  }

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-[#E8EBF0] border-b border-[#D4D7DE]">
      <h2 className="text-lg font-semibold text-[#1A1F2E]">{title}</h2>
      <div className="flex items-center gap-3">
        {user && (
          <span className="text-sm text-[#4A5568]">
            {user.name} <span className="text-xs">({user.role})</span>
          </span>
        )}
        <button
          onClick={handleLogout}
          aria-label="로그아웃"
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[#4A5568]
                     hover:bg-[rgba(0,0,0,0.05)] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
        >
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>
      </div>
    </header>
  )
}
```

### 9.5 `src/components/layout/AppLayout.tsx`

```tsx
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CriticalBanner } from '@/components/common/CriticalBanner'
import { useUiStore } from '@/store/uiStore'
import { useAlerts } from '@/hooks/queries/useAlerts'
import { useEffect } from 'react'

export function AppLayout() {
  const setCriticalCount = useUiStore((s) => s.setCriticalCount)
  const { data: criticalAlerts } = useAlerts({
    severity: 'critical',
    acknowledged: false,
    limit: 100,
  })

  // critical 카운트 전역 동기화
  useEffect(() => {
    setCriticalCount(criticalAlerts?.length ?? 0)
  }, [criticalAlerts, setCriticalCount])

  return (
    <div className="flex h-screen overflow-hidden bg-[#E8EBF0]">
      <CriticalBanner />
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
```

### 9.6 `src/components/layout/AuthLayout.tsx`

```tsx
import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-[#E8EBF0] flex items-center justify-center p-4">
      <Outlet />
    </div>
  )
}
```

---

## 10. 라우트 트리 (`src/App.tsx`)

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { AuthGuard } from '@/components/layout/AuthGuard'
import { AdminGuard } from '@/components/layout/AdminGuard'
import { LoginPage } from '@/pages/auth/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { SystemListPage } from '@/pages/system/SystemListPage'
import { AlertHistoryPage } from '@/pages/AlertHistoryPage'

// Phase 2+ 페이지 — Lazy
import { lazy, Suspense } from 'react'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
const TrendAlertPage = lazy(() => import('@/pages/TrendAlertPage'))

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 인증 레이아웃 */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>

        {/* 앱 레이아웃 (AuthGuard) */}
        <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/systems" element={<SystemListPage />} />
          <Route path="/alerts" element={<AlertHistoryPage />} />

          {/* Phase 2+ (Lazy) */}
          <Route path="/trends" element={
            <Suspense fallback={<LoadingSkeleton shape="card" />}>
              <TrendAlertPage />
            </Suspense>
          } />

          {/* Admin 전용 */}
          <Route path="/vector-health" element={
            <AdminGuard><div>Vector Health (Phase 3)</div></AdminGuard>
          } />
          <Route path="/admin/users" element={
            <AdminGuard><div>User Management (Phase 3)</div></AdminGuard>
          } />

          {/* Phase 2+ 플레이스홀더 */}
          <Route path="/contacts" element={<div className="p-6 text-[#4A5568]">Phase 2에서 구현</div>} />
          <Route path="/reports" element={<div className="p-6 text-[#4A5568]">Phase 2에서 구현</div>} />
          <Route path="/search" element={<div className="p-6 text-[#4A5568]">Phase 3에서 구현</div>} />
          <Route path="/feedback" element={<div className="p-6 text-[#4A5568]">Phase 3에서 구현</div>} />
          <Route path="/collector-configs" element={<div className="p-6 text-[#4A5568]">Phase 3에서 구현</div>} />
          <Route path="/profile" element={<div className="p-6 text-[#4A5568]">Phase 3에서 구현</div>} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
```

---

## 11. 페이지 설계

### 11.1 AUTH-01 로그인 페이지 (`src/pages/auth/LoginPage.tsx`)

**컴포넌트 트리:**
```
LoginPage
└── NeuCard (max-w-md, w-full)
    ├── Logo + "Synapse-V" 타이틀
    ├── <form> (react-hook-form + zod)
    │   ├── NeuInput (email, type="email", required)
    │   ├── NeuInput (password, type="password", required)
    │   ├── 에러 메시지 (잘못된 이메일/비밀번호)
    │   └── NeuButton (type="submit", loading=isPending)
    └── 저작권 텍스트
```

**상태 흐름:**
```
폼 제출
  → authApi.login({ email, password })
    성공: useAuthStore.login(resp) → navigate('/dashboard')
    실패 401: "이메일 또는 비밀번호가 올바르지 않습니다" 인라인 표시
    실패 기타: toast.error('로그인 중 오류가 발생했습니다')
```

**유효성 검사 (zod):**
```ts
const schema = z.object({
  email:    z.string().email('유효한 이메일을 입력하세요'),
  password: z.string().min(1, '비밀번호를 입력하세요'),
})
```

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import toast from 'react-hot-toast'

const schema = z.object({
  email:    z.string().email('유효한 이메일을 입력하세요'),
  password: z.string().min(1, '비밀번호를 입력하세요'),
})
type FormData = z.infer<typeof schema>

export function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)

  const { register, handleSubmit, formState: { errors }, setError } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const { mutate, isPending } = useMutation({
    mutationFn: authApi.login,
    onSuccess: (resp) => {
      login(resp)
      navigate('/dashboard', { replace: true })
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status: number } })?.response?.status
      if (status === 401) {
        setError('password', { message: '이메일 또는 비밀번호가 올바르지 않습니다' })
      } else {
        toast.error('로그인 중 오류가 발생했습니다')
      }
    },
  })

  return (
    <NeuCard className="w-full max-w-md">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-[#1A1F2E]">Synapse-V</h1>
        <p className="mt-1 text-sm text-[#4A5568]">통합 모니터링 시스템</p>
      </div>

      <form onSubmit={handleSubmit((data) => mutate(data))} className="space-y-4" noValidate>
        <NeuInput
          id="email"
          type="email"
          label="이메일"
          placeholder="admin@company.com"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <NeuInput
          id="password"
          type="password"
          label="비밀번호"
          placeholder="••••••••"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <NeuButton type="submit" className="w-full mt-6" loading={isPending}>
          로그인
        </NeuButton>
      </form>

      <p className="mt-6 text-center text-xs text-[#4A5568]">
        © 2025 Synapse-V. All rights reserved.
      </p>
    </NeuCard>
  )
}
```

---

### 11.2 DASH-01 운영 대시보드 (`src/pages/DashboardPage.tsx`)

**컴포넌트 트리:**
```
DashboardPage
├── PageHeader "운영 대시보드"  (우측: 마지막 갱신 시각)
├── SystemStatusGrid
│   └── SystemStatusCard × N  (클릭 → /dashboard/:id, Phase 2)
└── AlertFeed (최근 미확인 알림 목록, 30초 자동갱신)
    └── AlertFeedItem × N
```

**SystemStatusGrid / SystemStatusCard 설계:**
```tsx
// src/components/dashboard/SystemStatusCard.tsx
interface SystemStatusCardProps {
  system: System
  // Phase 2에서 최근 severity 정보 추가
}

// 카드 표시 내용:
// - display_name + system_type 배지
// - host
// - status 인디케이터 (active: 초록 dot, inactive: 회색 dot)
// - os_type 아이콘 (linux: Terminal, windows: Monitor)
```

**AlertFeed 설계:**
```
AlertFeed (useAlerts({ acknowledged: false, limit: 10 }))
  ├── 섹션 제목 "미확인 알림"  +  전체보기 → /alerts
  ├── 로딩: LoadingSkeleton shape="table" count=3
  ├── 빈 상태: EmptyState "미확인 알림이 없습니다"
  └── AlertFeedItem × N
      ├── severity NeuBadge (critical/warning/info)
      ├── title (최대 2줄)
      ├── system 이름 + formatRelative(created_at)
      └── AnomalyTypeBadge (anomaly_type이 있을 때만)
```

**자동 갱신:**
- `useAlerts` 훅의 `refetchInterval: 30_000` 으로 자동 처리.
- `useSystems` 훅의 `refetchInterval: 300_000` 으로 자동 처리.

```tsx
// src/pages/DashboardPage.tsx 핵심 구조
export function DashboardPage() {
  const { data: systems, isLoading: systemsLoading, error: systemsError, refetch: refetchSystems } = useSystems()
  const { data: recentAlerts, isLoading: alertsLoading } = useAlerts({
    acknowledged: false,
    limit: 10,
  })
  const [lastRefreshed, setLastRefreshed] = useState(new Date())

  // 데이터 갱신 시 마지막 갱신 시각 업데이트
  useEffect(() => {
    if (systems) setLastRefreshed(new Date())
  }, [systems])

  return (
    <div className="space-y-6">
      <PageHeader
        title="운영 대시보드"
        description={`마지막 갱신: ${formatKST(lastRefreshed.toISOString(), 'HH:mm')}`}
      />

      {/* 시스템 상태 그리드 */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-[#1A1F2E]">
          모니터링 시스템 ({systems?.length ?? 0}개)
        </h2>
        {systemsLoading ? (
          <LoadingSkeleton shape="card" count={6} />
        ) : systemsError ? (
          <ErrorCard onRetry={refetchSystems} />
        ) : (
          <SystemStatusGrid systems={systems ?? []} />
        )}
      </section>

      {/* 알림 피드 */}
      <AlertFeed alerts={recentAlerts ?? []} loading={alertsLoading} />
    </div>
  )
}
```

---

### 11.3 SYS-01/02 시스템 관리 (`src/pages/system/SystemListPage.tsx`)

**컴포넌트 트리:**
```
SystemListPage
├── PageHeader "시스템 관리"  (우측: NeuButton "시스템 등록" → Drawer 열기)
├── 검색 입력 (NeuInput, 클라이언트사이드 필터)
├── SystemTable
│   ├── 로딩: LoadingSkeleton shape="table"
│   ├── 빈 상태: EmptyState (시스템 등록 CTA)
│   └── 테이블 행: display_name, host, os_type, system_type, status, 액션
└── SystemFormDrawer (open 상태로 조건부 렌더)
    ├── 등록 모드: useCreateSystem()
    └── 수정 모드: useUpdateSystem(id)
```

**SystemTable 컬럼 정의:**

| 컬럼 | 표시 | 정렬 |
|---|---|---|
| display_name | 시스템명 (system_name 부제) | ✓ |
| host | 호스트 | - |
| system_type | 타입 배지 (web/was/db/middleware/other) | ✓ |
| os_type | OS (linux/windows 아이콘) | - |
| status | 상태 dot + 텍스트 | ✓ |
| actions | 수정/삭제 버튼 | - |

**SystemFormDrawer Props:**
```tsx
interface SystemFormDrawerProps {
  open: boolean
  onClose: () => void
  editTarget?: System   // undefined면 등록, 있으면 수정
}

// 폼 필드:
// - system_name (등록 시만 활성, 수정 시 disabled)
// - display_name *
// - host *
// - os_type (select: linux/windows) *
// - system_type (select: web/was/db/middleware/other) *
// - status (select: active/inactive)
// - teams_webhook_url
// - description (textarea)
```

**Drawer 구현 방식:**
- shadcn `Sheet` 컴포넌트를 사용하되 뉴모피즘 스타일 오버라이드.
- 우측 슬라이드 (side="right", width 480px).

**삭제 확인:**
- `window.confirm` 대신 shadcn `AlertDialog` 사용.
- `useDeleteSystem()` mutation 연결.

---

### 11.4 ALT-01 알림 이력 (`src/pages/AlertHistoryPage.tsx`)

**컴포넌트 트리:**
```
AlertHistoryPage
├── PageHeader "알림 이력"
├── 필터 바
│   ├── 탭: [전체] [메트릭] [로그분석]   (alert_type 필터)
│   ├── severity select (전체/info/warning/critical)
│   └── acknowledged select (전체/미확인/확인됨)
├── AlertTable
│   ├── 로딩: LoadingSkeleton shape="table"
│   ├── 빈 상태: EmptyState
│   └── 행 클릭 → AlertDetailPanel 오픈
└── AlertDetailPanel (오른쪽 Sheet)
    ├── severity 배지 + 제목
    ├── 시스템 + 발생 시각 (KST)
    ├── anomaly_type + similarity_score
    ├── description (whitespace-pre-wrap, LLM 텍스트)
    └── Acknowledge 버튼 (useAcknowledgeAlert)
```

**AlertTable 컬럼:**

| 컬럼 | 표시 |
|---|---|
| severity | NeuBadge (critical/warning/info) |
| alert_type | 배지 (메트릭/복구/로그분석) |
| title | 제목 (최대 1줄 truncate) |
| system_id | 시스템명 (시스템 목록 join — Phase 1에서는 ID 표시) |
| anomaly_type | AnomalyTypeBadge |
| created_at | formatRelative() |
| acknowledged | 체크 아이콘 or 미확인 배지 |

**AnomalyTypeBadge:**
```tsx
// src/components/alert/AnomalyTypeBadge.tsx
const LABELS: Record<AnomalyType, string> = {
  new:       '신규',
  related:   '유사',
  recurring: '반복',
  duplicate: '중복',
}
// anomalyColor(type)으로 배경색 결정
```

**페이지네이션:**
- `useState`로 `offset` 관리 (pageSize=20 고정).
- `useAlerts({ ...filters, limit: 20, offset })` 호출.
- 이전/다음 버튼 (데이터 < pageSize면 다음 버튼 비활성화).

**AlertDetailPanel — Acknowledge 플로우:**
```
NeuButton "확인 처리" 클릭
  → useAcknowledgeAlert.mutate({ id, by: user.name })
    성공: toast.success + Panel 닫기
    실패: toast.error
```

---

## 12. `src/main.tsx`

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from 'react-hot-toast'
import { queryClient } from '@/lib/queryClient'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#E8EBF0',
            color: '#1A1F2E',
            borderRadius: '12px',
            boxShadow: '6px 6px 12px #C8CBD4, -6px -6px 12px #FFFFFF',
          },
        }}
      />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>
)
```

---

## 13. Phase 1 완료 기준 체크리스트

### 스캐폴드
- [ ] `npm ci` 후 `npm run build` 오류 없음
- [ ] `npm audit --audit-level=high` 경고 없음
- [ ] Pretendard 폰트 로드 확인 (DevTools → Network → Fonts)
- [ ] `vite.config.ts` 프록시 `/api` → 8080, `/analyze` → 8000

### 인증
- [ ] `/login` 접근 시 로그인 폼 표시
- [ ] 잘못된 자격증명 → 인라인 에러 메시지
- [ ] 로그인 성공 → sessionStorage에 token 저장 + `/dashboard` 리다이렉트
- [ ] `/dashboard` 직접 접근 (비인증) → `/login` 리다이렉트
- [ ] DevTools Application → Cookies에서 `refresh_token` HttpOnly 확인
- [ ] 로그아웃 → sessionStorage 초기화 + `/login` 이동

### 레이아웃
- [ ] Sidebar collapse/expand 동작 (240px ↔ 64px)
- [ ] CriticalBanner: critical 미확인 알림 발생 시 상단 고정 배너 표시
- [ ] 현재 경로에 해당하는 NavItem 하이라이트
- [ ] admin 계정에서만 사용자 관리/벡터 상태 메뉴 표시

### DASH-01
- [ ] 시스템 상태 카드 그리드 표시
- [ ] 미확인 알림 피드 표시 (최대 10건)
- [ ] 30초마다 알림 피드 자동 갱신 (Network 탭 확인)
- [ ] 시스템 없음 → EmptyState 표시

### SYS-01/02
- [ ] 시스템 목록 테이블 표시
- [ ] 검색어로 클라이언트사이드 필터링
- [ ] 시스템 등록 Drawer → 저장 → 목록 갱신
- [ ] 시스템 수정 Drawer → system_name disabled 확인
- [ ] 삭제 AlertDialog 확인 후 삭제

### ALT-01
- [ ] 알림 이력 테이블 표시
- [ ] alert_type 탭 필터 동작
- [ ] severity / acknowledged 필터 동작
- [ ] 페이지네이션 (offset 기반)
- [ ] 행 클릭 → 상세 Panel 오픈
- [ ] description `whitespace-pre-wrap` 렌더 (dangerouslySetInnerHTML 사용 금지)
- [ ] Acknowledge 처리 → 행 상태 갱신

### 접근성
- [ ] 모든 인터랙티브 요소 키보드 탭 이동 가능
- [ ] focus ring 가시 (`focus:ring-2 focus:ring-[#6366F1]`)
- [ ] NeuInput에 반드시 `border` 포함 (그림자만 사용 금지)
- [ ] 텍스트 색상 `#4A5568` 사용 (WCAG AA 4.6:1)

---

## 14. 미구현 항목 (Phase 2+ 이관)

| 항목 | Phase | 비고 |
|---|---|---|
| DASH-02 시스템 상세 + MetricChart | 2 | recharts HourlyAggregation |
| CNT-01/02 담당자 관리 | 2 | |
| RPT-01/02 안정성 리포트 | 2 | PeriodToggle |
| SIM-01 유사 장애 검색 | 3 | log-analyzer /aggregation/search |
| TREND-01 트렌드 예측 | 3 | |
| SYS-03 수집기 마법사 | 3 | 5단계 StepWizard |
| AUTH-02/03 회원가입/승인 | 3 | |
| CommandPalette (Cmd+K) | 3 | |
| 다크 모드 | 3 | CSS @media prefers-color-scheme |
