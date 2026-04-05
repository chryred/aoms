# Synapse-V Frontend — Phase 2 상세 설계 명세서

> `frontend-design-spec.md` + `phase1-design-spec.md` 기반. Phase 2 구현 계약서.
> 구현 전 반드시 이 문서를 전체 숙지할 것.

---

## 0. 전제 조건 (Phase 1 완료 확인)

Phase 2 시작 전 다음이 모두 완료되어 있어야 한다.

| 항목 | 확인 방법 |
|---|---|
| `main-server/services/frontend/` Vite 프로젝트 존재 | `ls src/` |
| AppLayout + Sidebar collapse 동작 | 화면 확인 |
| AuthGuard + 로그인 페이지 (AUTH-01) 동작 | /login → /dashboard 리다이렉트 |
| DASH-01 운영 대시보드 (시스템 카드 목록) | /dashboard 접속 |
| SYS-01/02 시스템 관리 (목록/등록/수정) | /systems 접속 |
| ALT-01 알림 이력 (서버사이드 페이지네이션) | /alerts 접속 |
| ky 클라이언트 + react-query + zustand 세팅 | `src/lib/ky-client.ts` 존재 |

---

## 1. Phase 2 범위

| ID | 경로 | 설명 |
|---|---|---|
| CNT-01 | `/contacts` | 담당자 목록 (DataTable) |
| CNT-02 | `/contacts/new`, `/contacts/:id/edit` | 담당자 등록/수정 폼 |
| DASH-02 | `/dashboard/:systemId` | 시스템 상세 (MetricChart + 탭 패널) |
| RPT-01 | `/reports` | 안정성 리포트 (기간 토글 + 집계 카드) |
| RPT-02 | `/reports/history` | 리포트 발송 이력 (DataTable) |

---

## 2. 디렉토리 구조 추가분

Phase 1 구조에서 아래 파일/폴더를 추가한다.

```
src/
├── types/
│   ├── aggregation.ts          ← Phase 1에서 skeleton만 있었던 파일 완성
│   └── report.ts               ← 신규
├── api/
│   ├── contacts.ts             ← 신규
│   ├── aggregations.ts         ← 신규
│   └── reports.ts              ← 신규
├── hooks/
│   ├── queries/
│   │   ├── useContacts.ts      ← 신규
│   │   ├── useSystemContacts.ts← 신규
│   │   ├── useAggregations.ts  ← 신규
│   │   └── useReports.ts       ← 신규
│   └── mutations/
│       ├── useCreateContact.ts ← 신규
│       ├── useUpdateContact.ts ← 신규
│       ├── useDeleteContact.ts ← 신규
│       ├── useAddSystemContact.ts    ← 신규
│       └── useRemoveSystemContact.ts ← 신규
├── components/
│   ├── contacts/
│   │   ├── ContactForm.tsx     ← 신규
│   │   └── SystemContactPanel.tsx ← 신규 (DASH-02에서도 재사용)
│   ├── charts/
│   │   ├── MetricChart.tsx     ← 신규 (recharts)
│   │   └── SeverityBadge.tsx   ← 신규
│   └── reports/
│       ├── PeriodToggle.tsx    ← 신규
│       └── AggregationCard.tsx ← 신규
└── pages/
    ├── ContactListPage.tsx     ← 신규 (CNT-01)
    ├── ContactFormPage.tsx     ← 신규 (CNT-02)
    ├── SystemDetailPage.tsx    ← 신규 (DASH-02)
    ├── ReportPage.tsx          ← 신규 (RPT-01)
    └── ReportHistoryPage.tsx   ← 신규 (RPT-02)
```

---

## 3. TypeScript 타입 정의

### 3.1 `src/types/aggregation.ts` (완성판)

Phase 1에서 skeleton으로 남겨뒀던 파일을 실제 DB 컬럼 기준으로 완성한다.

```typescript
export type PeriodType = 'monthly' | 'quarterly' | 'half_year' | 'annual'
export type LlmSeverity = 'normal' | 'warning' | 'critical'

// metrics_json 파싱 결과 (collector_type별 다름)
export interface NodeMetrics {
  cpu_avg: number; cpu_max: number; cpu_min: number
  mem_avg: number; mem_max: number
  disk_avg: number; disk_max: number
}
export interface JvmMetrics {
  heap_avg: number; heap_max: number
  gc_count: number; gc_time_avg: number
}
export type MetricsPayload = NodeMetrics | JvmMetrics | Record<string, number>

export interface HourlyAggregation {
  id: number
  system_id: number
  hour_bucket: string       // ISO 8601 UTC
  collector_type: string
  metric_group: string
  metrics_json: string      // JSON string → MetricsPayload
  llm_summary: string | null
  llm_severity: LlmSeverity | null
  llm_trend: string | null
  llm_prediction: string | null
  llm_model_used: string | null
  qdrant_point_id: string | null
  created_at: string
}

export interface DailyAggregation {
  id: number
  system_id: number
  day_bucket: string        // ISO 8601 UTC
  collector_type: string
  metric_group: string
  metrics_json: string
  llm_summary: string | null
  llm_severity: LlmSeverity | null
  llm_trend: string | null
  qdrant_point_id: string | null
  created_at: string
}

export interface WeeklyAggregation {
  id: number
  system_id: number
  week_start: string        // 해당 주 월요일 00:00 UTC
  collector_type: string
  metric_group: string
  metrics_json: string
  llm_summary: string | null
  llm_severity: LlmSeverity | null
  llm_trend: string | null
  qdrant_point_id: string | null
  created_at: string
}

export interface MonthlyAggregation {
  id: number
  system_id: number
  period_start: string      // 해당 기간 시작일 UTC
  period_type: PeriodType
  collector_type: string
  metric_group: string
  metrics_json: string
  llm_summary: string | null
  llm_severity: LlmSeverity | null
  llm_trend: string | null
  qdrant_point_id: string | null
  created_at: string
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

// Recharts용 변환 결과
export interface ChartDataPoint {
  timestamp: string         // KST 표시용 (예: "14:00")
  [metric: string]: number | string
}
```

### 3.2 `src/types/report.ts` (신규)

```typescript
export type ReportType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_year' | 'annual'
export type TeamsStatus = 'sent' | 'failed'

export interface ReportHistory {
  id: number
  report_type: ReportType
  period_start: string      // ISO 8601 UTC
  period_end: string
  sent_at: string
  teams_status: TeamsStatus | null
  llm_summary: string | null
  system_count: number | null
}

// RPT-01 UI용 집계 뷰 타입 (집계 API 응답 → 화면 렌더링 중간 모델)
export interface ReportPeriodSummary {
  periodType: ReportType
  systemSummaries: SystemPeriodSummary[]
}

export interface SystemPeriodSummary {
  system_id: number
  system_name: string
  display_name: string
  aggregations: (DailyAggregation | WeeklyAggregation | MonthlyAggregation)[]
  worstSeverity: LlmSeverity
}
```

---

## 4. API 레이어

### 4.1 `src/api/contacts.ts`

```typescript
import { adminApi } from '@/lib/ky-client'
import type { Contact, SystemContact, SystemContactCreate } from '@/types/contact'

export const contactsApi = {
  getContacts: () =>
    adminApi.get('api/v1/contacts').json<Contact[]>(),

  getContact: (id: number) =>
    adminApi.get(`api/v1/contacts/${id}`).json<Contact>(),

  createContact: (body: ContactCreate) =>
    adminApi.post('api/v1/contacts', { json: body }).json<Contact>(),

  updateContact: (id: number, body: Partial<ContactCreate>) =>
    adminApi.patch(`api/v1/contacts/${id}`, { json: body }).json<Contact>(),

  deleteContact: (id: number) =>
    adminApi.delete(`api/v1/contacts/${id}`),

  // 시스템-담당자 연결
  getSystemContacts: (systemId: number) =>
    adminApi.get(`api/v1/systems/${systemId}/contacts`).json<Contact[]>(),

  addSystemContact: (systemId: number, body: SystemContactCreate) =>
    adminApi.post(`api/v1/systems/${systemId}/contacts`, { json: body }).json<SystemContact>(),

  removeSystemContact: (systemId: number, contactId: number) =>
    adminApi.delete(`api/v1/systems/${systemId}/contacts/${contactId}`),
}
```

### 4.2 `src/api/aggregations.ts`

```typescript
import { adminApi } from '@/lib/ky-client'
import type {
  HourlyAggregation, DailyAggregation,
  WeeklyAggregation, MonthlyAggregation,
  TrendAlert, PeriodType
} from '@/types/aggregation'

export interface HourlyParams {
  system_id?: number
  collector_type?: string
  metric_group?: string
  severity?: string
  from_dt?: string    // ISO 8601
  to_dt?: string
}

export const aggregationsApi = {
  getHourly: (params: HourlyParams) =>
    adminApi.get('api/v1/aggregations/hourly', {
      searchParams: params as Record<string, string | number>
    }).json<HourlyAggregation[]>(),

  getDaily: (params: { system_id?: number; collector_type?: string }) =>
    adminApi.get('api/v1/aggregations/daily', {
      searchParams: params as Record<string, string | number>
    }).json<DailyAggregation[]>(),

  getWeekly: (params: { system_id?: number; collector_type?: string }) =>
    adminApi.get('api/v1/aggregations/weekly', {
      searchParams: params as Record<string, string | number>
    }).json<WeeklyAggregation[]>(),

  getMonthly: (params: { system_id?: number; period_type?: PeriodType }) =>
    adminApi.get('api/v1/aggregations/monthly', {
      searchParams: params as Record<string, string | number>
    }).json<MonthlyAggregation[]>(),

  getTrendAlerts: () =>
    adminApi.get('api/v1/aggregations/trend-alert').json<TrendAlert[]>(),
}
```

### 4.3 `src/api/reports.ts`

```typescript
import { adminApi } from '@/lib/ky-client'
import type { ReportHistory, ReportType } from '@/types/report'

export const reportsApi = {
  getReports: (params?: { report_type?: ReportType; limit?: number }) =>
    adminApi.get('api/v1/reports', {
      searchParams: (params ?? {}) as Record<string, string | number>
    }).json<ReportHistory[]>(),

  getReport: (id: number) =>
    adminApi.get(`api/v1/reports/${id}`).json<ReportHistory>(),
}
```

---

## 5. React Query 훅 추가

### 5.1 `src/constants/queryKeys.ts` 추가분

기존 `qk` 객체에 다음을 추가한다.

```typescript
// 기존 qk 객체에 추가
contacts:       () => ['contacts'] as const,
contact:        (id: number) => ['contacts', id] as const,
systemContacts: (systemId: number) => ['systems', systemId, 'contacts'] as const,

aggregations: {
  hourly:   (params: HourlyParams) => ['aggregations', 'hourly', params] as const,
  daily:    (params: { system_id?: number; collector_type?: string }) =>
              ['aggregations', 'daily', params] as const,
  weekly:   (params: { system_id?: number }) =>
              ['aggregations', 'weekly', params] as const,
  monthly:  (params: { system_id?: number; period_type?: PeriodType }) =>
              ['aggregations', 'monthly', params] as const,
  trends:   () => ['aggregations', 'trends'] as const,
},

reports:        (type?: ReportType) => ['reports', type] as const,
```

### 5.2 `src/hooks/queries/useContacts.ts`

```typescript
export function useContacts() {
  return useQuery({
    queryKey: qk.contacts(),
    queryFn: () => contactsApi.getContacts(),
    staleTime: 120_000,
  })
}

export function useSystemContacts(systemId: number) {
  return useQuery({
    queryKey: qk.systemContacts(systemId),
    queryFn: () => contactsApi.getSystemContacts(systemId),
    staleTime: 60_000,
    enabled: systemId > 0,
  })
}
```

### 5.3 `src/hooks/queries/useAggregations.ts`

```typescript
// 시간별 집계 (DASH-02 MetricChart용)
export function useHourlyAggregations(params: HourlyParams) {
  return useQuery({
    queryKey: qk.aggregations.hourly(params),
    queryFn: () => aggregationsApi.getHourly(params),
    staleTime: 3_600_000,   // 1시간 — 배치 데이터
    enabled: !!params.system_id,
  })
}

// 일별 집계 (RPT-01 daily 탭)
export function useDailyAggregations(params: { system_id?: number; collector_type?: string }) {
  return useQuery({
    queryKey: qk.aggregations.daily(params),
    queryFn: () => aggregationsApi.getDaily(params),
    staleTime: 86_400_000,  // 24시간
  })
}

// 트렌드 알림 (DASH-02 예방 알림 섹션)
export function useTrendAlerts() {
  return useQuery({
    queryKey: qk.aggregations.trends(),
    queryFn: () => aggregationsApi.getTrendAlerts(),
    staleTime: 30_000,
    refetchInterval: 300_000,
  })
}
```

### 5.4 뮤테이션 훅

```typescript
// src/hooks/mutations/useCreateContact.ts
export function useCreateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ContactCreate) => contactsApi.createContact(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      toast.success('담당자가 등록되었습니다')
    },
  })
}

// src/hooks/mutations/useDeleteContact.ts
export function useDeleteContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => contactsApi.deleteContact(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      toast.success('담당자가 삭제되었습니다')
    },
  })
}

// src/hooks/mutations/useAddSystemContact.ts
export function useAddSystemContact(systemId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SystemContactCreate) =>
      contactsApi.addSystemContact(systemId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['systems', systemId, 'contacts'] })
      toast.success('담당자가 시스템에 연결되었습니다')
    },
  })
}
```

---

## 6. 페이지별 상세 설계

### 6.1 CNT-01 — 담당자 목록 (`/contacts`)

**컴포넌트**: `src/pages/ContactListPage.tsx`

```
ContactListPage
├── PageHeader
│   ├── 제목: "담당자 관리"
│   └── Button "담당자 등록" → navigate('/contacts/new')
├── DataTable<Contact>
│   ├── columns:
│   │   ├── name (정렬 가능)
│   │   ├── email
│   │   ├── teams_upn
│   │   ├── 알림 채널 배지 (webhook_url 존재 → "Webhook" 배지, teams_upn → "Teams" 배지)
│   │   ├── llm_api_key (마스킹 표시 또는 "-")
│   │   └── 액션 (수정 아이콘, 삭제 아이콘)
│   ├── 검색: name 또는 email 클라이언트 사이드 필터 (useMemo)
│   └── 삭제: ConfirmDialog → useDeleteContact
└── (시스템-담당자 연결은 DASH-02에서 관리)
```

**삭제 처리:**
- `DELETE /api/v1/contacts/{id}` — 204 No Content
- CASCADE로 `system_contacts` 레코드 자동 삭제됨 (DB FK)
- 삭제 전 "이 담당자가 연결된 시스템에서 제거됩니다" ConfirmDialog 표시

**ColumnDef 스펙:**

| 컬럼 key | 표시명 | 정렬 | 비고 |
|---|---|---|---|
| `name` | 이름 | O | bold |
| `email` | 이메일 | O | — |
| `teams_upn` | Teams UPN | X | 없으면 "-" |
| `channels` | 알림 채널 | X | 배지 조합 표시 |
| `llm_api_key` | LLM 키 | X | 마스킹값 그대로 표시 |
| `created_at` | 등록일 | O | formatKST |
| `actions` | 액션 | X | Pencil / Trash2 아이콘 |

---

### 6.2 CNT-02 — 담당자 등록/수정 (`/contacts/new`, `/contacts/:id/edit`)

**컴포넌트**: `src/pages/ContactFormPage.tsx`
**공통 폼**: `src/components/contacts/ContactForm.tsx`

```
ContactFormPage
├── PageHeader
│   ├── 신규: "담당자 등록"
│   └── 수정: "담당자 수정 — {name}"
└── ContactForm
    ├── name: NeuInput required
    ├── email: NeuInput type="email"
    ├── teams_upn: NeuInput placeholder="user@company.com"
    ├── webhook_url: NeuInput type="url"
    ├── llm_api_key: NeuInput type="password"
    │   └── 수정 시: 마스킹된 값 표시, 수정하지 않으면 그대로 유지
    ├── agent_code: NeuInput
    └── FormActions
        ├── Button "취소" → navigate(-1)
        └── Button "저장" type="submit" (isPending 시 spinner)
```

**폼 유효성 검사 (zod):**

```typescript
const contactSchema = z.object({
  name: z.string().min(1, '이름을 입력해주세요').max(100),
  email: z.string().email('올바른 이메일 형식이 아닙니다').optional().or(z.literal('')),
  teams_upn: z.string().optional(),
  webhook_url: z.string().url('올바른 URL 형식이 아닙니다').optional().or(z.literal('')),
  llm_api_key: z.string().optional(),
  agent_code: z.string().optional(),
})
```

**수정 모드 처리:**
- `useParams()` → `id` 존재 시 수정 모드
- `useContact(id)` 로 기존 데이터 로드 → `reset(data)` 로 폼 초기화
- `llm_api_key`: 마스킹 값("sk-abc***") 표시 → 사용자가 변경하지 않으면 빈 문자열로 PATCH 전송하지 않음
  - **구현 포인트**: `llm_api_key` 필드가 마스킹 패턴(`***` 포함)이면 body에서 제외

---

### 6.3 DASH-02 — 시스템 상세 (`/dashboard/:systemId`)

**컴포넌트**: `src/pages/SystemDetailPage.tsx`

```
SystemDetailPage
├── PageHeader
│   ├── 시스템명 + 상태 배지 (active/inactive)
│   └── breadcrumb: 대시보드 > {display_name}
├── SystemInfoCard           ← NeuCard: host, os_type, system_type
├── TrendAlertBanner         ← llm_severity=warning/critical인 TrendAlert 존재 시 노출
│   └── llm_prediction 텍스트 (whitespace-pre-wrap)
└── Tabs
    ├── Tab "메트릭"          ← 기본 선택
    │   ├── CollectorTypeSelector (수평 탭: node_exporter | jmx_exporter | ...)
    │   ├── TimeRangeSelector (최근 6h | 12h | 24h | 48h)
    │   └── MetricChart[]    ← metric_group별 차트 렌더링
    ├── Tab "알림"
    │   └── AlertList        ← 기존 useAlerts({ system_id }) 재사용
    ├── Tab "분석"
    │   └── AnalysisList     ← 기존 useAnalyses({ system_id }) 재사용
    └── Tab "담당자"
        └── SystemContactPanel
```

#### MetricChart 컴포넌트 (`src/components/charts/MetricChart.tsx`)

```typescript
interface MetricChartProps {
  aggregations: HourlyAggregation[]
  metricKeys: string[]         // 표시할 메트릭 키 목록 (metrics_json 파싱 결과 키)
  title: string                // 차트 상단 제목 (예: "CPU 사용률")
  unit?: string                // Y축 단위 (예: "%", "MB")
  onPointClick?: (hourBucket: string) => void  // 드릴다운: 알림 탭 이동
}
```

**내부 데이터 변환 (`src/lib/metrics-transform.ts`):**

```typescript
export function transformToChartData(
  aggregations: HourlyAggregation[],
  metricKeys: string[]
): ChartDataPoint[] {
  return aggregations.map(agg => {
    const parsed = JSON.parse(agg.metrics_json) as MetricsPayload
    const point: ChartDataPoint = {
      timestamp: formatKST(agg.hour_bucket, 'HH:mm'),
      llm_severity: agg.llm_severity ?? 'normal',
    }
    for (const key of metricKeys) {
      if (key in parsed) point[key] = (parsed as Record<string, number>)[key]
    }
    return point
  })
}
```

**Recharts 구성:**

```tsx
// recharts ComposedChart 사용
// - avg 계열: Line (solid)
// - max 계열: Line (dashed, 옅은 색)
// - llm_severity=warning 구간: ReferenceLine (노란 점선)
// - llm_severity=critical 구간: ReferenceLine (빨간 점선)
// - CustomTooltip: llm_summary, llm_prediction 표시
```

**collector_type별 metricKeys 매핑:**

| collector_type | metric_group | metricKeys |
|---|---|---|
| node_exporter | cpu | `['cpu_avg', 'cpu_max']` |
| node_exporter | memory | `['mem_avg', 'mem_max']` |
| node_exporter | disk | `['disk_avg', 'disk_max']` |
| jmx_exporter | jvm_heap | `['heap_avg', 'heap_max']` |
| jmx_exporter | gc | `['gc_count', 'gc_time_avg']` |
| (기타) | * | `Object.keys(JSON.parse(metrics_json))` 동적 추출 |

#### SystemContactPanel 컴포넌트 (`src/components/contacts/SystemContactPanel.tsx`)

```
SystemContactPanel (props: systemId)
├── 연결된 담당자 목록 (useSystemContacts)
│   └── 행마다: 이름, role 배지, 알림 채널 배지, 연결 해제 버튼
├── "담당자 추가" 버튼
│   └── Sheet (우측 슬라이드)
│       ├── 전체 담당자 Select (useContacts)
│       ├── role Select: primary | secondary | escalation
│       ├── notify_channels Checkbox 그룹: teams, webhook
│       └── "연결" 버튼 → useAddSystemContact
└── 빈 상태: EmptyState (아이콘: Users, "연결된 담당자가 없습니다")
```

---

### 6.4 RPT-01 — 안정성 리포트 (`/reports`)

**컴포넌트**: `src/pages/ReportPage.tsx`

```
ReportPage
├── PageHeader "안정성 리포트"
├── PeriodToggle          ← daily | weekly | monthly | quarterly | half_year | annual
│   └── URL searchParam: ?period=daily (기본값)
├── SystemFilter          ← 시스템 선택 (전체 / 특정 시스템)
└── ReportBody
    ├── (daily 선택 시)
    │   └── 시스템별 DailyAggregationCard[]
    ├── (weekly 선택 시)
    │   └── 시스템별 WeeklyAggregationCard[]
    └── (monthly/quarterly/half_year/annual 선택 시)
        └── 시스템별 MonthlyAggregationCard[]
```

#### PeriodToggle 컴포넌트 (`src/components/reports/PeriodToggle.tsx`)

```typescript
interface PeriodToggleProps {
  value: ReportType
  onChange: (period: ReportType) => void
}

// 버튼 목록
const PERIOD_LABELS: Record<ReportType, string> = {
  daily:     '일별',
  weekly:    '주별',
  monthly:   '월별',
  quarterly: '분기',
  half_year: '반기',
  annual:    '연간',
}
```

**구현**: `useSearchParams`로 URL 상태 관리. 뒤로가기 시 이전 선택 기간 복원.

#### AggregationCard 컴포넌트 (`src/components/reports/AggregationCard.tsx`)

```typescript
interface AggregationCardProps {
  systemName: string
  displayName: string
  aggregation: DailyAggregation | WeeklyAggregation | MonthlyAggregation
  onDrillDown?: () => void   // → /dashboard/:systemId
}
```

**카드 레이아웃:**

```
NeuCard (severity=worstSeverity)
├── 헤더: display_name + severity 배지
├── 기간 표시 (day_bucket / week_start / period_start, formatKST)
├── metrics_json 요약 (collector_type별 핵심 메트릭 2~3개)
│   예: node_exporter → "CPU avg 45% | MEM avg 72%"
├── llm_summary (whitespace-pre-wrap, 최대 3줄 line-clamp)
├── llm_trend (이탤릭 텍스트)
└── "상세 보기" 링크 → /dashboard/:systemId
```

**데이터 조회 전략:**
- `period=daily` → `useQuery(aggregationsApi.getDaily({ system_id }))`
- `period=weekly` → `useQuery(aggregationsApi.getWeekly({ system_id }))`
- `period=monthly|quarterly|half_year|annual` → `useQuery(aggregationsApi.getMonthly({ period_type }))`
- system_id 미선택(전체) 시 시스템 목록 × 집계 데이터 클라이언트 사이드 병합

**빈 상태 처리:**
- 집계 데이터 없음 → EmptyState "해당 기간의 집계 데이터가 없습니다. n8n WF7-WF10 워크플로우가 실행되면 자동으로 채워집니다."

---

### 6.5 RPT-02 — 리포트 발송 이력 (`/reports/history`)

**컴포넌트**: `src/pages/ReportHistoryPage.tsx`

```
ReportHistoryPage
├── PageHeader "리포트 발송 이력"
│   └── SubNav: "안정성 리포트" ← (현재) "발송 이력"
└── DataTable<ReportHistory>
    ├── filterSlot: ReportType Select (전체 / 일별 / 주별 / ...)
    └── columns:
        ├── report_type: 한국어 라벨 배지
        ├── period_start ~ period_end: "YYYY.MM.DD ~ YYYY.MM.DD" KST
        ├── sent_at: formatRelative (KST)
        ├── teams_status: "발송 완료" (초록) / "발송 실패" (빨강) 배지
        ├── system_count: "{n}개 시스템"
        └── llm_summary: 최대 80자 truncate + Tooltip
```

**페이지네이션:** 서버 측 `limit` 파라미터 사용 (기본 30). 무한 스크롤 X — 단순 numbered pagination.

---

## 7. 공통 컴포넌트

### 7.1 SeverityBadge (`src/components/charts/SeverityBadge.tsx`)

```typescript
interface SeverityBadgeProps {
  severity: LlmSeverity | Severity
  size?: 'sm' | 'md'
}

// 색상 매핑
// normal   → text-[#22C55E] bg-[rgba(34,197,94,0.1)]
// warning  → text-[#D97706] bg-[rgba(217,119,6,0.1)]
// critical → text-[#DC2626] bg-[rgba(220,38,38,0.1)]
// info     → text-[#6366F1] bg-[rgba(99,102,241,0.1)]
```

### 7.2 ContactRoleBadge

```typescript
// role 배지 색상
// primary    → 파란색
// secondary  → 회색
// escalation → 주황색
```

---

## 8. 라우트 등록

`src/router.tsx` (또는 Phase 1에서 구성한 라우터 파일)에 추가:

```tsx
// Phase 2 추가 라우트 (AppLayout 하위)
<Route path="contacts" element={<ContactListPage />} />
<Route path="contacts/new" element={<ContactFormPage />} />
<Route path="contacts/:id/edit" element={<ContactFormPage />} />
<Route path="dashboard/:systemId" element={<SystemDetailPage />} />
<Route path="reports" element={<ReportPage />} />
<Route path="reports/history" element={<ReportHistoryPage />} />
```

---

## 9. 유틸리티 추가 (`src/lib/utils.ts`)

Phase 1에서 구현한 유틸리티 외에 아래를 추가한다.

```typescript
// metrics_json 파싱 후 핵심 메트릭 요약 문자열 생성
export function summarizeMetrics(
  metricsJson: string,
  collectorType: string
): string {
  const parsed = JSON.parse(metricsJson) as Record<string, number>
  if (collectorType === 'node_exporter') {
    const parts: string[] = []
    if ('cpu_avg' in parsed) parts.push(`CPU avg ${parsed.cpu_avg.toFixed(1)}%`)
    if ('mem_avg' in parsed) parts.push(`MEM avg ${parsed.mem_avg.toFixed(1)}%`)
    if ('disk_avg' in parsed) parts.push(`Disk avg ${parsed.disk_avg.toFixed(1)}%`)
    return parts.join(' | ')
  }
  if (collectorType === 'jmx_exporter') {
    const parts: string[] = []
    if ('heap_avg' in parsed) parts.push(`Heap avg ${parsed.heap_avg.toFixed(1)}%`)
    if ('gc_count' in parsed) parts.push(`GC ${parsed.gc_count}회`)
    return parts.join(' | ')
  }
  // custom: 첫 3개 키만 표시
  return Object.entries(parsed).slice(0, 3)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ')
}

// 집계 기간 표시 문자열
export function formatPeriodLabel(
  periodType: ReportType,
  startDate: string,
  endDate?: string
): string {
  // daily   → "2025.01.15 (수)"
  // weekly  → "2025.01.13 ~ 2025.01.19"
  // monthly → "2025년 1월"
  // quarterly → "2025년 1분기"
  // ...
}

// LlmSeverity → NeuCard severity prop 변환
export function llmSeverityToCardSeverity(
  s: LlmSeverity | null
): 'normal' | 'warning' | 'critical' {
  if (s === 'warning') return 'warning'
  if (s === 'critical') return 'critical'
  return 'normal'
}
```

---

## 10. 의존성 추가 없음

Phase 2는 Phase 1에서 설치한 패키지(recharts, react-hook-form, zod, lucide-react 등)만으로 구현 가능하다. 추가 패키지 설치 불필요.

---

## 11. 검증 체크리스트 (Phase 2 완료 기준)

### CNT-01/02 담당자 관리
- [ ] `/contacts` 접속 시 DataTable에 담당자 목록 출력
- [ ] 이름/이메일 클라이언트 사이드 검색 동작
- [ ] `/contacts/new` 에서 담당자 등록 후 목록 페이지로 이동
- [ ] `/contacts/:id/edit` 에서 기존 값이 폼에 채워짐
- [ ] `llm_api_key` 수정 시: 값 변경하지 않으면 PATCH body에 포함되지 않음
- [ ] 담당자 삭제 시 ConfirmDialog 노출 후 삭제

### DASH-02 시스템 상세
- [ ] `/dashboard/:systemId` 접속 시 시스템 정보 카드 출력
- [ ] 메트릭 탭: collector_type 선택 + 시간 범위 변경 시 API 재조회
- [ ] MetricChart: avg/max 라인, warning/critical ReferenceLine 렌더링
- [ ] 차트 포인트 클릭 시 알림 탭으로 전환 (+ hour_bucket 필터 적용)
- [ ] TrendAlert가 있으면 상단 배너 표시
- [ ] 담당자 탭: 시스템에 연결된 담당자 목록 + 추가/삭제 동작
- [ ] 알림/분석 탭: Phase 1 구현체 재사용 확인

### RPT-01 안정성 리포트
- [ ] PeriodToggle URL searchParam 동기화 (새로고침 후 선택 유지)
- [ ] 기간 전환 시 적절한 집계 API 호출 (daily/weekly/monthly 구분)
- [ ] AggregationCard: severity border 색상 표시
- [ ] llm_summary, llm_trend whitespace-pre-wrap 렌더링
- [ ] 데이터 없음 → EmptyState 표시
- [ ] "상세 보기" → /dashboard/:systemId 이동

### RPT-02 리포트 발송 이력
- [ ] `/reports/history` 접속 시 발송 이력 DataTable 출력
- [ ] report_type 필터 동작
- [ ] teams_status 배지 색상 (sent=초록, failed=빨강)
- [ ] llm_summary Tooltip 동작 (80자 초과 시)

### 공통
- [ ] `npm run build` 오류 없음
- [ ] Lighthouse Accessibility 90점 이상 유지
- [ ] 모든 신규 페이지 키보드 탭 이동 + Focus ring 가시
