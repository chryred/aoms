# Synapse-V Frontend — Phase 3d 상세 설계 명세서

> `frontend-design-spec.md` + `phase3a~c-design-spec.md` 기반. Phase 3 마무리 기능 구현 계약서.
> 구현 전 반드시 이 문서를 전체 숙지할 것.

---

## 0. 전제 조건 (Phase 1 ~ 3c 완료 확인)

| 항목 | 확인 방법 |
|---|---|
| Phase 1 전체 완료 (AppLayout, Sidebar, Auth, DASH-01, SYS-01/02, ALT-01) | 각 경로 접속 |
| Phase 2 전체 완료 (CNT, DASH-02, RPT) | 각 경로 접속 |
| Phase 3a 완료 (SIM-01, TREND-01) | `/search`, `/trends` 접속 |
| Phase 3b 완료 (SYS-03, COL-01) | `/collector-configs` 접속 |
| Phase 3c 완료 (AUTH-02/03, PROFILE) | `/register`, `/admin/users`, `/profile` 접속 |
| `useAnalyses` 훅 Phase 1/2에서 구현 완료 | `src/hooks/queries/` 확인 |
| `logAnalyzerApi` (ky 클라이언트) 구현 완료 | `src/lib/ky-client.ts` 확인 |
| `uiStore.ts` (`criticalCount` 상태) 구현 완료 | `src/store/uiStore.ts` 확인 |

---

## 1. Phase 3d 범위

| ID | 경로 | 설명 | 가드 |
|---|---|---|---|
| FEED-01 | `/feedback` | 피드백 관리 — has_solution 현황 | AuthGuard |
| VEC-01 | `/vector-health` | 벡터 컬렉션 상태 | AdminGuard |
| — | (전역) | CommandPalette (Cmd+K) | AuthGuard 내부 |
| — | (전역) | 다크 모드 토글 | — |

---

## 2. 디렉토리 구조 추가분

```
src/
├── types/
│   └── vector.ts                         ← 신규 (VEC-01용 컬렉션 상태 타입)
├── api/
│   └── logAnalyzer.ts                    ← Phase 3a에서 생성됨 — getCollectionInfo 함수 추가
├── hooks/
│   └── queries/
│       ├── useFeedback.ts                ← 신규 (has_solution 필터 useAnalyses 확장)
│       └── useVectorHealth.ts            ← 신규
├── components/
│   ├── feedback/
│   │   └── FeedbackStatusCard.tsx        ← 신규
│   ├── vector/
│   │   └── CollectionStatusCard.tsx      ← 신규
│   └── common/
│       ├── CommandPalette.tsx            ← 신규 (Cmd+K 전역)
│       └── ThemeProvider.tsx             ← 신규 (다크모드 context)
├── store/
│   └── themeStore.ts                     ← 신규 (Zustand: light | dark)
└── pages/
    ├── FeedbackManagementPage.tsx        ← 신규 (FEED-01)
    └── VectorHealthPage.tsx              ← 신규 (VEC-01)
```

---

## 3. TypeScript 타입 추가

### 3.1 `src/types/vector.ts` (신규)

```typescript
// log-analyzer GET /aggregation/collections/info 응답 기반
export interface CollectionInfo {
  name: string              // "metric_hourly_patterns" | "aggregation_summaries"
  points_count: number
  status: 'green' | 'yellow' | 'red' | string  // Qdrant 컬렉션 상태
  vectors_count?: number
}

export interface CollectionsInfoResponse {
  collections: CollectionInfo[]
}

// 전체 4개 컬렉션을 합산하여 UI에 표시하는 모델
export interface VectorCollectionSummary {
  name: string
  displayName: string       // 한국어 표시명
  points_count: number
  status: 'green' | 'yellow' | 'red'
  description: string       // 컬렉션 용도 설명
  source: 'log-analyzer'    // 데이터 출처
}
```

### 3.2 `src/types/auth.ts` 다크모드 관련

별도 타입 파일 불필요 — `themeStore.ts` 내부에서 `type Theme = 'light' | 'dark'` 로컬 정의.

---

## 4. API 레이어

### 4.1 `src/api/logAnalyzer.ts` 추가 (Phase 3a 파일에 함수 추가)

```typescript
// Phase 3a에서 생성된 파일에 추가
export const logAnalyzerApi = {
  // ... Phase 3a에서 정의된 함수들 ...

  // VEC-01용: 집계 컬렉션 상태 조회
  getAggregationCollectionsInfo: () =>
    logAnalyzerApi_instance.get('aggregation/collections/info')
      .json<CollectionsInfoResponse>(),

  // 일반 컬렉션 상태 조회 (log_incidents, metric_baselines)
  // log-analyzer의 /collections/{type}/create POST로 컬렉션 존재 확인
  // → 실제로는 Qdrant SDK 없이 health로 간접 확인
  //   log_incidents / metric_baselines는 /aggregation/collections/info에 미포함
  //   → VEC-01에서는 aggregation collections만 표시
}
```

> **참고**: log-analyzer의 `/aggregation/collections/info`는 `metric_hourly_patterns`와
> `aggregation_summaries` 두 컬렉션만 반환한다. `log_incidents`와 `metric_baselines`는
> 별도 엔드포인트가 없으므로 VEC-01에서는 집계 컬렉션 2개 + 헬스 상태만 표시한다.

### 4.2 FEED-01은 기존 analysisApi 재사용

```typescript
// 신규 API 추가 없음 — Phase 1/2에서 구현된 analysisApi.getAnalyses() 활용
// has_solution 필터는 백엔드 미지원 → 클라이언트 사이드 필터링

// src/hooks/queries/useFeedback.ts 참조
```

---

## 5. React Query 훅 추가

### 5.1 `src/constants/queryKeys.ts` 추가분

```typescript
// 기존 qk 객체에 추가
vectorHealth:   () => ['vector-health'] as const,
```

### 5.2 `src/hooks/queries/useFeedback.ts`

```typescript
import { useAnalyses } from './useAnalyses'  // Phase 1/2에서 구현됨
import type { AnalysisFilterParams } from '@/api/analysis'

// has_solution 필터를 클라이언트 사이드로 처리
export function useFeedbackStats(params: AnalysisFilterParams = {}) {
  const query = useAnalyses({ ...params, limit: 500 })
  return {
    ...query,
    data: query.data
      ? {
          total: query.data.length,
          resolved: query.data.filter(a => a.has_solution === true),
          unresolved: query.data.filter(a => a.has_solution === false || a.has_solution === null),
          bySystem: groupBySystem(query.data),
        }
      : undefined,
  }
}

function groupBySystem(analyses: LogAnalysis[]) {
  return analyses.reduce((acc, item) => {
    const key = item.system_id ?? 0
    if (!acc[key]) acc[key] = { resolved: 0, unresolved: 0 }
    if (item.has_solution) acc[key].resolved++
    else acc[key].unresolved++
    return acc
  }, {} as Record<number, { resolved: number; unresolved: number }>)
}
```

### 5.3 `src/hooks/queries/useVectorHealth.ts`

```typescript
export function useVectorHealth() {
  return useQuery({
    queryKey: qk.vectorHealth(),
    queryFn: () => logAnalyzerApi.getAggregationCollectionsInfo(),
    staleTime: 60_000,
    refetchInterval: 120_000,    // 2분마다 자동 갱신
    retry: 2,
  })
}
```

---

## 6. FEED-01 — 피드백 관리 (`/feedback`)

**컴포넌트**: `src/pages/FeedbackManagementPage.tsx`

### 6.1 페이지 개요

피드백 관리 페이지는 LLM 로그 분석 이력(`log_analysis_history`) 중 **해결책 등록 여부**를 모니터링하는 현황 대시보드다.

> **아키텍처 이해**: 실제 해결책 등록은 Teams 알림의 "해결책 등록" 버튼 → `GET /api/v1/feedback/form` HTML 폼 → n8n WF3 webhook 순으로 진행된다. FEED-01은 이 결과를 조회하는 읽기 전용 뷰다.

### 6.2 컴포넌트 트리

```
FeedbackManagementPage
├── PageHeader "피드백 관리"
├── SummaryRow (NeuCard 3개 — 가로 배치)
│   ├── SummaryCard: 전체 분석 건수
│   ├── SummaryCard: 해결책 등록 완료 (초록, has_solution=true)
│   └── SummaryCard: 미등록 (주황, has_solution=false/null)
├── FilterRow
│   ├── SystemSelect: 시스템 선택 (전체 / 특정 시스템)
│   ├── SeveritySelect: 심각도 필터 (전체 / warning / critical)
│   └── HasSolutionToggle: 전체 / 등록 완료 / 미등록
└── DataTable<LogAnalysis>
    ├── columns:
    │   ├── created_at: formatRelative (hover → KST 절대시간 Tooltip)
    │   ├── system_id: 시스템명 표시 (useSystems로 id→name 매핑)
    │   ├── severity: SeverityBadge
    │   ├── root_cause: 최대 80자 truncate + Tooltip
    │   ├── has_solution: "등록 완료" (초록) / "미등록" (회색) 배지
    │   ├── anomaly_type: AnomalyTypeBadge (new/related/recurring/duplicate)
    │   └── 액션: "피드백 폼 열기" 아이콘 버튼 (has_solution=false 행만)
    ├── onRowClick: 상세 SidePanel 열기
    └── exportFileName: "feedback-history"  (CSV 내보내기 활성화)
```

### 6.3 피드백 폼 연동 (`has_solution=false` 행의 액션 버튼)

```typescript
// Teams 알림이 아닌 프론트엔드에서 직접 폼 링크 생성
function buildFeedbackFormUrl(analysis: LogAnalysis): string {
  const base = import.meta.env.VITE_ADMIN_API_URL ?? ''
  const params = new URLSearchParams({
    alert_id: String(analysis.id),
    system:   analysis.system_id ? String(analysis.system_id) : '',
    point_id: analysis.qdrant_point_id ?? '',
  })
  return `${base}/api/v1/feedback/form?${params}`
}

// 버튼 클릭 → window.open(url, '_blank', 'noopener,noreferrer')
```

> **보안**: `noopener,noreferrer` 반드시 포함. 피드백 폼은 admin-api가 서빙하는 별도 HTML 페이지.

### 6.4 LogAnalysis 상세 SidePanel

DataTable 행 클릭 시 우측 Sheet 열기:

```
Sheet
├── 제목: "LLM 분석 상세"
├── severity + anomaly_type 배지 행
├── 생성일시: KST 절대시간
├── 시스템명
├── instance_role
├── root_cause (whitespace-pre-wrap)
├── recommendation (whitespace-pre-wrap)
├── model_used
├── similarity_score (있을 경우: "유사도 {score * 100:.0f}%")
├── has_solution 상태 표시
└── (has_solution=false) "피드백 폼 열기" 버튼
```

---

## 7. VEC-01 — 벡터 컬렉션 상태 (`/vector-health`)

**컴포넌트**: `src/pages/VectorHealthPage.tsx`
**가드**: AdminGuard (role !== 'admin' → /dashboard + 403 toast)

### 7.1 컴포넌트 트리

```
VectorHealthPage
├── PageHeader
│   ├── 제목: "벡터 컬렉션 상태"
│   └── 배지: [관리자 전용] (ShieldCheck 아이콘)
├── ConnectionStatusBar     ← log-analyzer 연결 상태 표시
│   ├── 정상: "log-analyzer 연결됨" (초록 dot)
│   └── 오류: "log-analyzer 연결 불가 — 벡터 기능 비활성화" (빨강 dot)
├── CollectionGrid (2열 그리드)
│   ├── CollectionStatusCard: metric_hourly_patterns
│   └── CollectionStatusCard: aggregation_summaries
├── LogicCollectionSection (제목: "로그 분석 컬렉션")
│   └── 설명 텍스트: "log_incidents, metric_baselines는 log-analyzer 내부 관리
│                    — 포인트 수 조회 엔드포인트 미지원"
└── RefreshButton "새로고침" + 마지막 조회 시각 표시
```

### 7.2 CollectionStatusCard (`src/components/vector/CollectionStatusCard.tsx`)

```typescript
interface CollectionStatusCardProps {
  info: CollectionInfo
  displayName: string
  description: string
}
```

**카드 레이아웃:**

```
NeuCard (severity=상태에 따라)
├── 헤더
│   ├── 컬렉션 표시명 (displayName)
│   └── 상태 dot: green=초록 / yellow=노랑 / red=빨강 (실시간 Qdrant 상태)
├── 포인트 수: "{points_count:,} points" (큰 숫자 폰트)
├── 내부 이름: "컬렉션: {name}" (보조 텍스트)
└── 용도 설명 (description, text-sm)
```

**컬렉션 표시 정보:**

| 컬렉션명 | displayName | description |
|---|---|---|
| `metric_hourly_patterns` | 시간별 메트릭 패턴 | WF6가 저장하는 1시간 집계 LLM 분석 패턴. 유사도 검색 기반 |
| `aggregation_summaries` | 집계 기간 요약 | WF7~WF10이 저장하는 일/주/월 리포트 요약 |

### 7.3 에러/빈 상태 처리

```
log-analyzer 연결 실패 (네트워크 오류):
  → ErrorCard "log-analyzer 서비스에 연결할 수 없습니다" + 재시도 버튼

points_count = 0:
  → 카드에 노란 경고 아이콘 + "데이터 없음 — WF12 실행 후 WF6~WF10이 실행되면 적재됩니다"
```

---

## 8. CommandPalette — 전역 빠른 검색 (Cmd+K)

**컴포넌트**: `src/components/common/CommandPalette.tsx`
**패키지**: `cmdk` (shadcn/ui Command 내부 사용) — Phase 1 패키지 목록에 포함됨

### 8.1 트리거

```typescript
// AppLayout 내 전역 단축키 등록
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setOpen(true)
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [])
```

Sidebar에도 검색 아이콘 배치 (collapsed 시 아이콘, expanded 시 "검색 Cmd+K" 텍스트).

### 8.2 검색 대상 (3가지 그룹)

```
CommandPalette (Dialog)
├── Input: 검색어 입력
├── Group "페이지 이동"
│   ├── 대시보드          → /dashboard
│   ├── 알림 이력         → /alerts
│   ├── 시스템 관리       → /systems
│   ├── 담당자 관리       → /contacts
│   ├── 안정성 리포트     → /reports
│   ├── 유사 장애 검색    → /search
│   ├── 트렌드 예측 알림  → /trends
│   └── ... (전체 라우트 목록)
├── Group "시스템" (useSystems 데이터, 최대 10개)
│   └── {display_name} ({system_name}) → /dashboard/{id}
└── Group "알림 이력" (useAlerts 데이터, 최신 20개, 검색어 일치 시만 표시)
    └── {title} — {severity} {formatRelative(created_at)} → /alerts?highlight={id}
```

### 8.3 구현 상세

```typescript
// src/components/common/CommandPalette.tsx
import { Command } from 'cmdk'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { data: systems } = useSystems()
  const navigate = useNavigate()

  const handleSelect = (path: string) => {
    navigate(path)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden max-w-lg">
        <Command>
          <Command.Input placeholder="검색..." />
          <Command.List>
            <Command.Empty>결과가 없습니다</Command.Empty>

            <Command.Group heading="페이지 이동">
              {ROUTES_LIST.map(route => (
                <Command.Item
                  key={route.path}
                  onSelect={() => handleSelect(route.path)}
                >
                  {route.icon}
                  {route.label}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="시스템">
              {systems?.map(sys => (
                <Command.Item
                  key={sys.id}
                  onSelect={() => handleSelect(`/dashboard/${sys.id}`)}
                >
                  <Server className="w-4 h-4 mr-2" />
                  {sys.display_name}
                  <span className="ml-2 text-xs text-[#4A5568]">
                    {sys.system_name}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
```

### 8.4 `src/constants/routes.ts` — ROUTES_LIST 정의

```typescript
// CommandPalette에서 사용하는 전체 라우트 목록
export const ROUTES_LIST = [
  { path: '/dashboard',          label: '운영 대시보드',      icon: <LayoutDashboard /> },
  { path: '/alerts',             label: '알림 이력',          icon: <Bell /> },
  { path: '/systems',            label: '시스템 관리',         icon: <Server /> },
  { path: '/contacts',           label: '담당자 관리',         icon: <Users /> },
  { path: '/reports',            label: '안정성 리포트',       icon: <BarChart3 /> },
  { path: '/reports/history',    label: '리포트 발송 이력',    icon: <History /> },
  { path: '/search',             label: '유사 장애 검색',      icon: <Search /> },
  { path: '/trends',             label: '트렌드 예측 알림',    icon: <TrendingUp /> },
  { path: '/feedback',           label: '피드백 관리',         icon: <MessageSquare /> },
  { path: '/collector-configs',  label: '수집기 설정',         icon: <Settings /> },
  { path: '/profile',            label: '내 프로필',           icon: <UserCircle /> },
  // admin only (role 체크는 CommandPalette 렌더링 시 필터링)
  { path: '/admin/users',        label: '사용자 승인 관리',    icon: <ShieldCheck />, adminOnly: true },
  { path: '/vector-health',      label: '벡터 컬렉션 상태',    icon: <Database />,    adminOnly: true },
] as const
```

---

## 9. 다크 모드 토글

### 9.1 테마 스토어 (`src/store/themeStore.ts`)

```typescript
type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      toggleTheme: () => set({ theme: get().theme === 'light' ? 'dark' : 'light' }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'aoms-theme',
      storage: createJSONStorage(() => localStorage),  // 탭 닫아도 유지
    }
  )
)
```

### 9.2 ThemeProvider (`src/components/common/ThemeProvider.tsx`)

```typescript
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useThemeStore(s => s.theme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
  }, [theme])

  return <>{children}</>
}
```

`main.tsx` 최상단에서 `<ThemeProvider>` 로 전체 앱 감싸기.

### 9.3 다크 토큰 (CSS — `src/index.css`)

```css
/* 라이트 토큰 (기존) */
:root, .light {
  --color-bg-base: #E8EBF0;
  --color-surface: #E8EBF0;
  --shadow-neu-flat: 6px 6px 12px #C8CBD4, -6px -6px 12px #FFFFFF;
  --shadow-neu-inset: inset 4px 4px 8px #C8CBD4, inset -4px -4px 8px #FFFFFF;
  --color-text-primary: #1A1F2E;
  --color-text-secondary: #4A5568;
  --color-accent: #6366F1;
}

/* 다크 토큰 — 미드나이트 슬레이트 */
.dark {
  --color-bg-base: #1A1F2E;
  --color-surface: #222840;
  --shadow-neu-flat: 6px 6px 12px #141826, -6px -6px 12px #202538;
  --shadow-neu-inset: inset 4px 4px 8px #141826, inset -4px -4px 8px #202538;
  --color-text-primary: #E8EBF0;
  --color-text-secondary: #9CA3AF;
  --color-accent: #818CF8;   /* 다크에서는 인디고 밝게 */
}
```

### 9.4 토글 버튼 위치

**TopBar** (`src/components/layout/TopBar.tsx`) 우측에 배치:

```tsx
// 아이콘 토글 버튼
<button
  onClick={toggleTheme}
  aria-label={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'}
  className="rounded-xl p-2 ..."
>
  {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
</button>
```

---

## 10. AppLayout 최종 통합

Phase 3d 완료 후 AppLayout에 추가/확인할 항목:

```typescript
// src/components/layout/AppLayout.tsx
export function AppLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false)

  return (
    <ThemeProvider>              {/* ← Phase 3d 추가 */}
      <CriticalBanner />         {/* Phase 1 — criticalCount > 0 시 */}
      <div className="flex h-screen bg-[--color-bg-base]">
        <Sidebar onPaletteOpen={() => setPaletteOpen(true)} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <TopBar />               {/* 다크모드 토글 포함 */}
          <div className="flex-1 overflow-y-auto p-6">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette              {/* ← Phase 3d 추가 */}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
      <Toaster position="bottom-right" />
    </ThemeProvider>
  )
}
```

---

## 11. 라우트 등록

`src/router.tsx`에 추가:

```tsx
// Phase 3d 추가 라우트 (AppLayout 하위)
<Route path="feedback" element={<FeedbackManagementPage />} />

// AdminGuard 감싸기
<Route path="vector-health" element={
  <AdminGuard><VectorHealthPage /></AdminGuard>
} />
```

---

## 12. 패키지 최종 확인

Phase 3d 신규 패키지: **없음**
`cmdk`는 shadcn/ui Command 초기화 시 이미 포함됨.

```bash
# 확인
npm ls cmdk    # shadcn Command 컴포넌트 의존성으로 설치되어야 함
```

---

## 13. 검증 체크리스트

### FEED-01 피드백 관리
- [ ] `/feedback` 접속 시 상단 요약 카드 3개 (전체 / 해결 / 미해결) 수치 정상 표시
- [ ] has_solution 토글 필터 동작 (전체 / 등록 완료 / 미등록)
- [ ] 시스템/심각도 필터 조합 동작
- [ ] 행 클릭 → SidePanel 열림, root_cause/recommendation `whitespace-pre-wrap` 렌더링
- [ ] `has_solution=false` 행 → "피드백 폼 열기" 버튼 노출, `window.open` + `noopener` 확인
- [ ] `has_solution=true` 행 → 액션 버튼 미노출
- [ ] CSV 내보내기 동작
- [ ] `dangerouslySetInnerHTML` 미사용 확인

### VEC-01 벡터 컬렉션 상태
- [ ] `/vector-health` — admin 계정으로 접속 시 정상 표시
- [ ] `/vector-health` — operator 계정으로 접속 시 `/dashboard` 리다이렉트 + 403 toast
- [ ] CollectionStatusCard 2개 (`metric_hourly_patterns`, `aggregation_summaries`) 표시
- [ ] points_count 숫자 정상 렌더링
- [ ] log-analyzer 연결 실패 시 ErrorCard + 재시도 버튼 노출
- [ ] 2분 자동 갱신 동작 (Network 탭 확인)

### CommandPalette
- [ ] `Cmd+K` (Mac) / `Ctrl+K` (Windows) 단축키로 팔레트 열림
- [ ] Sidebar 검색 아이콘 클릭으로도 열림
- [ ] 페이지 이동 목록 검색 동작
- [ ] 시스템 목록 표시 + 클릭 시 `/dashboard/:id` 이동
- [ ] adminOnly 항목(사용자 승인, 벡터 상태)은 admin 계정에서만 표시
- [ ] Esc 키로 팔레트 닫힘
- [ ] 팔레트 열린 상태에서 body 스크롤 잠금

### 다크 모드
- [ ] TopBar의 Moon/Sun 아이콘 클릭 시 테마 전환
- [ ] 전환 후 새로고침해도 테마 유지 (localStorage 확인)
- [ ] 다크 모드에서 뉴모피즘 shadow 정상 렌더링 (DevTools Computed → box-shadow 확인)
- [ ] 다크 모드에서 Critical/Warning 배지 색상 가시성 확인
- [ ] 다크 모드에서 텍스트 대비 WCAG AA 준수 (보조 텍스트 `#9CA3AF` 대비 4.5:1 이상)
- [ ] Focus ring 다크 모드에서도 가시 확인

### 전체 Phase 3 완료 기준
- [ ] `npm run build` 오류 없음
- [ ] `npm audit --audit-level=high` 경고 없음
- [ ] Lighthouse Accessibility 90점 이상 유지
- [ ] 모든 라우트 Cmd+K CommandPalette에서 검색 가능
- [ ] 다크/라이트 모드 양쪽에서 모든 페이지 시각적 이상 없음
