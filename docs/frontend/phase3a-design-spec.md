# Synapse-V Frontend — Phase 3a 상세 설계 명세서

> `frontend-design-spec.md` + `phase2-design-spec.md` 기반. Phase 3a 구현 계약서.
> 구현 전 반드시 이 문서를 전체 숙지할 것.

---

## 0. 전제 조건 (Phase 1, 2 완료 확인)

Phase 3a 시작 전 다음이 모두 완료되어 있어야 한다.

| 항목 | 확인 방법 |
|---|---|
| Phase 1: AppLayout + Sidebar collapse, AuthGuard, DASH-01, SYS-01/02, ALT-01 | 각 경로 접속 |
| Phase 2: CNT-01/02, DASH-02, RPT-01, RPT-02 완료 | 각 경로 접속 |
| `src/types/aggregation.ts` — `TrendAlert` 타입 정의 완료 | 파일 확인 |
| `src/api/aggregations.ts` — `getTrendAlerts()` 함수 구현 완료 | 파일 확인 |
| `src/hooks/queries/useAggregations.ts` — `useTrendAlerts()` 훅 구현 완료 | 파일 확인 |
| log-analyzer `POST /aggregation/search` 엔드포인트 동작 | `curl -X POST http://log-analyzer:8000/aggregation/search` |
| log-analyzer `GET /aggregation/collections/info` 엔드포인트 동작 | `curl http://log-analyzer:8000/aggregation/collections/info` |
| admin-api `GET /api/v1/aggregations/trend-alert` 엔드포인트 동작 | `curl http://admin-api:8080/api/v1/aggregations/trend-alert` |

---

## 1. Phase 3a 범위

| ID | 경로 | 설명 |
|---|---|---|
| SIM-01 | `/search` | 유사 장애 검색 (자연어 쿼리 → Qdrant 벡터 검색) |
| TREND-01 | `/trends` | 트렌드 예측 알림 목록 (프로액티브 장애 예방) |

---

## 2. 디렉토리 구조 추가분

Phase 1, 2 구조에서 아래 파일/폴더를 추가한다.

```
src/
├── types/
│   └── search.ts                        ← 신규 (SimilarSearchResult 등)
├── api/
│   └── logAnalyzer.ts                   ← 신규 (similarSearch, getCollectionInfo)
├── hooks/
│   ├── queries/
│   │   └── useTrendAlerts.ts            ← 신규 (독립 파일로 분리)
│   └── mutations/
│       └── useSimilarSearch.ts          ← 신규 (POST → useMutation)
├── components/
│   ├── search/
│   │   ├── SimilarSearchInput.tsx       ← 신규 (textarea + 슬라이더 + 버튼)
│   │   └── SimilarResultCard.tsx        ← 신규 (유사도 배지 + LLM 요약)
│   └── trends/
│       ├── TrendAlertCard.tsx           ← 신규 (severity 배지 + 예측 텍스트)
│       └── CriticalTrendBanner.tsx      ← 신규 (critical 건수 배너)
└── pages/
    ├── SimilarSearchPage.tsx            ← 신규 (SIM-01)
    └── TrendAlertsPage.tsx              ← 신규 (TREND-01)
```

---

## 3. TypeScript 타입 추가

### 3.1 `src/types/search.ts` (신규)

`TrendAlert` 타입은 Phase 2에서 `src/types/aggregation.ts`에 이미 정의되어 있으므로 중복 정의하지 않는다.

```typescript
// POST /aggregation/search 요청 본문
export interface SimilarSearchRequest {
  query_text: string        // 자연어 검색 쿼리
  collection: string        // "metric_hourly_patterns" | "aggregation_summaries"
  system_id?: number        // 특정 시스템만 검색 (undefined = 전체)
  limit?: number            // 기본 10
  score_threshold?: number  // 기본 0.70 (0.5 ~ 1.0)
}

// Qdrant에서 반환되는 단일 검색 결과 항목
// metric_hourly_patterns payload 구조
export interface HourlyPatternPayload {
  system_id: number
  system_name: string
  hour_bucket: string       // ISO 8601 UTC
  collector_type: string
  metric_group: string
  summary_text: string
  llm_severity: string      // "normal" | "warning" | "critical"
  llm_trend: string | null
  llm_prediction: string | null
  pg_row_id: number
  stored_at: string
}

// aggregation_summaries payload 구조
export interface AggSummaryPayload {
  system_id: number
  system_name: string
  period_type: string       // "daily" | "weekly" | "monthly" | "quarterly" | "half_year" | "annual"
  period_start: string      // ISO 8601 UTC
  summary_text: string
  dominant_severity: string // "normal" | "warning" | "critical"
  pg_row_id: number
  stored_at: string
}

export type SearchResultPayload = HourlyPatternPayload | AggSummaryPayload

// 단일 검색 결과 (Qdrant search result)
export interface SimilarSearchResult {
  id: string                           // Qdrant point UUID
  score: number                        // 유사도 점수 (0.0 ~ 1.0)
  payload: SearchResultPayload
}

// POST /aggregation/search 응답 전체
export interface SimilarSearchResponse {
  count: number
  results: SimilarSearchResult[]
}

// GET /aggregation/collections/info 응답
export interface CollectionStatus {
  points_count: number
  vectors_count: number
  status: string   // "green" | "yellow" | "red" | "not_found" | "error"
}

export interface CollectionsInfo {
  metric_hourly_patterns: CollectionStatus
  aggregation_summaries: CollectionStatus
}

// UI 검색 상태 관리 (useSearchParams 기반)
export interface SearchParams {
  q: string
  threshold: number    // 0.5 ~ 1.0
  collection: string   // "metric_hourly_patterns" | "aggregation_summaries"
}
```

---

## 4. API 레이어

### 4.1 `src/api/logAnalyzer.ts` (신규)

log-analyzer 서비스 전용 ky 클라이언트를 사용한다. `adminApi`가 아닌 `logAnalyzerApi` 인스턴스를 사용해야 한다.

```typescript
import ky from 'ky'
import type {
  SimilarSearchRequest,
  SimilarSearchResponse,
  CollectionsInfo,
} from '@/types/search'
import type { TrendAlert } from '@/types/aggregation'

// nginx에서 /aggregation/ → log-analyzer:8000 으로 프록시됨
export const logAnalyzerApi = ky.create({
  prefixUrl: '/aggregation',
  timeout: 15_000,
  credentials: 'include',
  hooks: {
    beforeRequest: [
      (request) => {
        // accessToken 주입 (adminApi와 동일한 방식)
        const token = useAuthStore.getState().token
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
      },
    ],
  },
})

export const logAnalyzerSearchApi = {
  /**
   * POST /aggregation/search
   * 자연어 쿼리를 Qdrant에서 유사 집계 기간으로 검색.
   * timeout: 15,000ms (임베딩 + 검색 지연 고려)
   */
  similarSearch: (body: SimilarSearchRequest): Promise<SimilarSearchResponse> =>
    logAnalyzerApi.post('search', {
      json: body,
      timeout: 15_000,
    }).json<SimilarSearchResponse>(),

  /**
   * GET /aggregation/collections/info
   * metric_hourly_patterns, aggregation_summaries 컬렉션 상태 확인.
   */
  getCollectionInfo: (): Promise<CollectionsInfo> =>
    logAnalyzerApi.get('collections/info').json<CollectionsInfo>(),
}
```

> **참고**: `getTrendAlerts`는 Phase 2에서 `src/api/aggregations.ts`의 `aggregationsApi.getTrendAlerts()`로 이미 구현되어 있다 (`GET /api/v1/aggregations/trend-alert` → adminApi). 중복 구현하지 않는다.

---

## 5. React Query 훅

### 5.1 `src/constants/queryKeys.ts` 추가분

기존 `qk` 객체에 다음을 추가한다.

```typescript
// 기존 qk 객체에 추가
search: {
  collectionInfo: () => ['search', 'collection-info'] as const,
},
// aggregations.trends는 Phase 2에서 이미 정의됨 — 중복 추가 불필요
```

### 5.2 `src/hooks/mutations/useSimilarSearch.ts` (신규)

검색은 POST 요청이므로 `useQuery`가 아닌 `useMutation`을 사용한다.

```typescript
import { useMutation } from '@tanstack/react-query'
import { logAnalyzerSearchApi } from '@/api/logAnalyzer'
import type { SimilarSearchRequest, SimilarSearchResponse } from '@/types/search'

export function useSimilarSearch() {
  return useMutation<SimilarSearchResponse, Error, SimilarSearchRequest>({
    mutationFn: (body: SimilarSearchRequest) =>
      logAnalyzerSearchApi.similarSearch(body),
  })
}
```

### 5.3 `src/hooks/queries/useTrendAlerts.ts` (신규 독립 파일)

Phase 2에서 `useAggregations.ts` 내부에 `useTrendAlerts`가 구현되어 있다면 이 파일에서 re-export하거나, 해당 훅을 독립 파일로 분리한다.

```typescript
import { useQuery } from '@tanstack/react-query'
import { aggregationsApi } from '@/api/aggregations'
import { qk } from '@/constants/queryKeys'
import { useUiStore } from '@/store/uiStore'

export function useTrendAlerts() {
  const setCriticalCount = useUiStore(s => s.setCriticalCount)

  return useQuery({
    queryKey: qk.aggregations.trends(),
    queryFn: () => aggregationsApi.getTrendAlerts(),
    staleTime: 30_000,          // 30초
    refetchInterval: 300_000,   // 5분 자동 갱신
    select: (data) => {
      // critical 건수 전역 스토어 업데이트 (CriticalBanner 연동)
      const criticalCount = data.filter(a => a.llm_severity === 'critical').length
      setCriticalCount(criticalCount)

      // critical → warning → normal 순 정렬
      return [...data].sort((a, b) => {
        const order = { critical: 0, warning: 1, normal: 2 }
        return (order[a.llm_severity] ?? 2) - (order[b.llm_severity] ?? 2)
      })
    },
  })
}
```

### 5.4 `src/hooks/queries/useCollectionInfo.ts` (신규)

```typescript
import { useQuery } from '@tanstack/react-query'
import { logAnalyzerSearchApi } from '@/api/logAnalyzer'
import { qk } from '@/constants/queryKeys'

export function useCollectionInfo() {
  return useQuery({
    queryKey: qk.search.collectionInfo(),
    queryFn: () => logAnalyzerSearchApi.getCollectionInfo(),
    staleTime: 60_000,
    retry: 1,
  })
}
```

---

## 6. SIM-01 상세 설계 (`/search`)

**컴포넌트**: `src/pages/SimilarSearchPage.tsx`

### 6.1 컴포넌트 트리

```
SimilarSearchPage
├── PageHeader
│   ├── 제목: "유사 장애 검색"
│   └── 부제목: "자연어로 유사한 과거 장애 패턴을 검색합니다"
├── CollectionInfoBar           ← useCollectionInfo (컬렉션 상태 + point 수 표시)
├── SimilarSearchInput          ← 쿼리 입력 + 슬라이더 + 컬렉션 선택 + 검색 버튼
└── SearchResultArea
    ├── (isPending) → <LoadingSkeleton shape="card" count={3} />
    ├── (isError)   → <ErrorCard onRetry={reset+mutate} />
    ├── (data.count === 0) → <EmptyState ... />
    └── (data.count > 0)  → SimilarResultCard[]
```

### 6.2 URL 상태 관리

`useSearchParams`로 검색 상태를 URL에 동기화한다. 북마크·공유·뒤로가기 시 검색 상태 복원이 가능하다.

```typescript
// URL 파라미터 구조
// ?q=CPU+사용률+급증&threshold=0.75&collection=metric_hourly_patterns

const [searchParams, setSearchParams] = useSearchParams()

const query      = searchParams.get('q') ?? ''
const threshold  = Number(searchParams.get('threshold') ?? '0.75')
const collection = searchParams.get('collection') ?? 'metric_hourly_patterns'
```

### 6.3 SimilarSearchInput 컴포넌트 (`src/components/search/SimilarSearchInput.tsx`)

```typescript
interface SimilarSearchInputProps {
  defaultQuery?: string
  defaultThreshold?: number
  defaultCollection?: string
  onSearch: (params: { query: string; threshold: number; collection: string }) => void
  isPending: boolean
}
```

**레이아웃:**

```
SimilarSearchInput (NeuCard)
├── CollectionToggle (수평 버튼 그룹)
│   ├── "시간별 패턴"   → collection = "metric_hourly_patterns"
│   └── "기간별 요약"   → collection = "aggregation_summaries"
├── textarea
│   ├── placeholder: "예: CPU 사용률이 80%를 초과하며 응답시간이 급증한 패턴"
│   ├── rows=4
│   ├── className: "whitespace-pre-wrap ..."  ← LLM 텍스트 평문 렌더링 규칙 준수
│   └── aria-label="검색 쿼리 입력"
├── ThresholdSlider
│   ├── label: "유사도 기준값"
│   ├── min=0.5 max=1.0 step=0.05 defaultValue=0.75
│   └── 현재값 표시: "{(threshold * 100).toFixed(0)}%"
└── Button "검색" (type="button", disabled=isPending, onClick=handleSearch)
    └── isPending → <Loader2 className="animate-spin" />
```

**debounce 처리 (S7 보안 권장사항):**

검색 버튼 클릭 이벤트에는 500ms debounce를 적용하여 중복 API 호출을 방지한다.

```typescript
const handleSearch = useMemo(
  () =>
    debounce((params: { query: string; threshold: number; collection: string }) => {
      if (!params.query.trim()) return
      setSearchParams({
        q: params.query,
        threshold: String(params.threshold),
        collection: params.collection,
      })
      onSearch(params)
    }, 500),
  [setSearchParams, onSearch]
)

// 컴포넌트 언마운트 시 debounce 취소
useEffect(() => () => handleSearch.cancel(), [handleSearch])
```

**접근성:**

- textarea: `aria-label`, `aria-describedby` 연결 (임계값 설명 ID)
- 슬라이더: `aria-label="유사도 기준값"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`
- 검색 버튼: isPending 중 `aria-busy="true"`, `aria-label="검색 중"`
- Focus ring: `focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2`

### 6.4 검색 실행 로직 (SimilarSearchPage)

```typescript
const { mutate, data, isPending, isError, reset } = useSimilarSearch()

// URL 파라미터 변경 감지 → 자동 검색 실행
useEffect(() => {
  if (!query.trim()) return
  mutate({
    query_text: query,
    collection,
    score_threshold: threshold,
    limit: 10,
  })
}, [query, threshold, collection]) // eslint-disable-line react-hooks/exhaustive-deps
```

### 6.5 SimilarResultCard 컴포넌트 (`src/components/search/SimilarResultCard.tsx`)

```typescript
interface SimilarResultCardProps {
  result: SimilarSearchResult
  collection: string
}
```

**카드 레이아웃:**

```
NeuCard (severity=llm_severity or dominant_severity)
├── 헤더 (flex justify-between)
│   ├── 유사도 점수 배지
│   │   └── "{(score * 100).toFixed(1)}%" 표시
│   │       score ≥ 0.95 → bg-[rgba(34,197,94,0.15)] text-[#15803D]  (매우 유사)
│   │       score ≥ 0.85 → bg-[rgba(99,102,241,0.15)] text-[#4338CA] (높음)
│   │       score ≥ 0.70 → bg-[rgba(217,119,6,0.15)] text-[#92400E]  (유사)
│   └── SeverityBadge (llm_severity 또는 dominant_severity)
├── 시스템명 + 기간 (flex gap-2)
│   ├── system_name (font-semibold)
│   └── 기간 텍스트 (text-[#4A5568] text-sm)
│       metric_hourly_patterns → formatKST(hour_bucket, 'datetime')
│       aggregation_summaries  → formatPeriodLabel(period_type, period_start)
├── collector_type + metric_group 배지 (metric_hourly_patterns에만 표시)
├── LLM 요약 (summary_text)
│   └── <p className="whitespace-pre-wrap text-sm text-[#1A1F2E]">
│       ← dangerouslySetInnerHTML 절대 금지
├── (metric_hourly_patterns) llm_prediction 텍스트
│   └── <p className="whitespace-pre-wrap text-sm italic text-[#4A5568]">
└── 푸터
    └── "관련 알림 이력" 링크 → /alerts?system_id={payload.system_id}
        └── <Link className="text-[#6366F1] text-sm hover:underline focus:ring-2 ...">
```

### 6.6 빈 상태 및 로딩 상태

```typescript
// 검색 전 (쿼리 없음)
<EmptyState
  icon={<Search className="w-12 h-12 text-[#4A5568]" />}
  title="유사 장애를 검색해보세요"
  description="과거 메트릭 패턴이나 집계 요약에서 유사한 상황을 찾아드립니다."
/>

// 검색 결과 없음 (0건)
<EmptyState
  icon={<SearchX className="w-12 h-12 text-[#4A5568]" />}
  title="유사한 장애 패턴을 찾지 못했습니다"
  description={`유사도 기준값(${(threshold * 100).toFixed(0)}%)을 낮추거나 검색어를 변경해보세요.`}
/>
```

---

## 7. TREND-01 상세 설계 (`/trends`)

**컴포넌트**: `src/pages/TrendAlertsPage.tsx`

### 7.1 컴포넌트 트리

```
TrendAlertsPage
├── PageHeader
│   ├── 제목: "트렌드 예측 알림"
│   └── 우측: RefreshIndicator ("5분 자동 갱신" 텍스트 + 마지막 갱신 시각)
├── CriticalTrendBanner        ← critical 건수 > 0 일 때만 표시
├── SeverityFilterBar          ← 심각도 필터 (전체 / warning / critical)
└── TrendAlertList
    ├── (isLoading) → <LoadingSkeleton shape="card" count={5} />
    ├── (isError)   → <ErrorCard onRetry={refetch} />
    ├── (filtered.length === 0) → <EmptyState ... />
    └── TrendAlertCard[] (critical → warning 순 정렬 — useTrendAlerts의 select에서 처리)
```

### 7.2 심각도 필터 및 자동 갱신 표시

```typescript
// URL searchParam: ?severity=all|warning|critical
const [searchParams, setSearchParams] = useSearchParams()
const severityFilter = searchParams.get('severity') ?? 'all'

const { data: trendAlerts = [], isLoading, isError, refetch, dataUpdatedAt } = useTrendAlerts()

const filtered = useMemo(() => {
  if (severityFilter === 'all') return trendAlerts
  return trendAlerts.filter(a => a.llm_severity === severityFilter)
}, [trendAlerts, severityFilter])
```

**RefreshIndicator (우측 상단):**

```tsx
<div className="flex items-center gap-2 text-sm text-[#4A5568]">
  <RefreshCw className="w-4 h-4" />
  <span>5분 자동 갱신</span>
  {dataUpdatedAt > 0 && (
    <span className="text-xs">
      마지막 갱신: {formatRelative(new Date(dataUpdatedAt).toISOString())}
    </span>
  )}
</div>
```

### 7.3 CriticalTrendBanner 컴포넌트 (`src/components/trends/CriticalTrendBanner.tsx`)

```typescript
interface CriticalTrendBannerProps {
  count: number   // critical 건수
}
```

critical 건수가 1 이상일 때 페이지 상단에 고정 배너를 표시한다.
`uiStore.criticalCount`를 업데이트하여 AppLayout의 전역 CriticalBanner와도 연동한다.

```tsx
// useTrendAlerts의 select에서 setCriticalCount를 이미 호출하므로,
// CriticalTrendBanner는 criticalCount를 props로 받아 렌더링만 담당한다.
{count > 0 && (
  <div
    role="alert"
    className="rounded-xl bg-[rgba(220,38,38,0.08)] border border-[#DC2626]
               border-l-4 border-l-[#DC2626] px-4 py-3 flex items-center gap-3"
  >
    <AlertTriangle className="w-5 h-5 text-[#DC2626] flex-shrink-0" aria-hidden="true" />
    <p className="text-[#DC2626] text-sm font-medium">
      임박한 장애 예측 {count}건이 감지되었습니다. 즉시 확인이 필요합니다.
    </p>
  </div>
)}
```

### 7.4 TrendAlertCard 컴포넌트 (`src/components/trends/TrendAlertCard.tsx`)

```typescript
interface TrendAlertCardProps {
  alert: TrendAlert & { display_name?: string; system_name?: string }
}
```

`TrendAlert` 타입은 `src/types/aggregation.ts`의 기존 정의를 그대로 사용한다.
(`GET /api/v1/aggregations/trend-alert` 응답에는 `display_name`, `system_name` 필드가 추가 포함됨.)

**카드 레이아웃:**

```
NeuCard (severity=llm_severity, pressed=false)
├── 헤더 (flex justify-between items-start)
│   ├── 좌측
│   │   ├── SeverityBadge (llm_severity)  ← "warning" / "critical"
│   │   └── 시스템명: display_name ?? system_name (font-semibold text-[#1A1F2E])
│   └── 우측
│       └── 발생 시각: formatRelative(hour_bucket)  (text-xs text-[#4A5568])
├── metric_group + collector_type (flex gap-2)
│   ├── <span className="text-xs bg-[rgba(99,102,241,0.1)] text-[#4338CA] px-2 py-0.5 rounded">
│   │     {metric_group}
│   │   </span>
│   └── <span className="text-xs text-[#4A5568]">{collector_type}</span>
├── llm_prediction (장애 예측 텍스트)
│   └── <p className="whitespace-pre-wrap text-sm text-[#1A1F2E] mt-2">
│       ← dangerouslySetInnerHTML 절대 금지
├── llm_summary (요약, 최대 3줄)
│   └── <p className="text-sm text-[#4A5568] line-clamp-3 mt-1">
│       ← dangerouslySetInnerHTML 절대 금지
└── 푸터
    └── "시스템 상세 보기" 링크 → /dashboard/{system_id}
        └── <Link className="text-[#6366F1] text-sm hover:underline
                             focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2">
```

### 7.5 빈 상태

```typescript
// 전체 데이터 없음
<EmptyState
  icon={<ShieldCheck className="w-12 h-12 text-[#22C55E]" />}
  title="현재 임박한 장애 예측이 없습니다"
  description="모든 시스템이 정상 범위에서 운영되고 있습니다."
/>

// 필터 적용 후 결과 없음
<EmptyState
  icon={<Filter className="w-12 h-12 text-[#4A5568]" />}
  title={`${severityFilter === 'warning' ? 'Warning' : 'Critical'} 수준의 예측 알림이 없습니다`}
  description="다른 심각도를 선택하거나 '전체'를 선택해보세요."
  cta={{ label: '전체 보기', onClick: () => setSearchParams({ severity: 'all' }) }}
/>
```

---

## 8. 라우트 등록

`src/router.tsx`에 Phase 3a 라우트를 추가한다.

```tsx
import { lazy } from 'react'

const SimilarSearchPage = lazy(() => import('@/pages/SimilarSearchPage'))
const TrendAlertsPage   = lazy(() => import('@/pages/TrendAlertsPage'))

// AppLayout 하위 라우트에 추가
<Route path="search"  element={<SimilarSearchPage />} />
<Route path="trends"  element={<TrendAlertsPage />} />
```

> Sidebar의 기존 NavItem 연결 확인:
> - `NavItem /search` 아이콘: `Search` — NavGroup "분석" 하위
> - `NavItem /trends` 아이콘: `TrendingUp` — NavGroup "운영" 하위

---

## 9. 검증 체크리스트

### SIM-01 유사 장애 검색 (`/search`)

- [ ] `/search` 접속 시 빈 상태(EmptyState) + SimilarSearchInput 렌더링
- [ ] 컬렉션 토글: "시간별 패턴" / "기간별 요약" 전환 → URL `collection` 파라미터 변경
- [ ] textarea 입력 → 검색 버튼 클릭 → URL `?q=...&threshold=...&collection=...` 갱신
- [ ] URL 직접 접근 시 파라미터 기반으로 자동 검색 실행
- [ ] 유사도 슬라이더 0.5 ~ 1.0 범위 동작, 기본값 0.75
- [ ] 검색 중 버튼 disabled + 스피너 표시 (`aria-busy` 확인)
- [ ] 결과 카드: 유사도 배지(%), SeverityBadge, 시스템명, 기간, summary_text 표시
- [ ] `summary_text`, `llm_prediction` → `whitespace-pre-wrap` 평문 렌더링 (`dangerouslySetInnerHTML` 미사용 확인)
- [ ] "관련 알림 이력" 링크 → `/alerts?system_id={id}` 이동
- [ ] 결과 0건 → EmptyState "유사한 장애 패턴을 찾지 못했습니다" + 임계값 안내
- [ ] debounce 500ms 동작 (빠른 연속 클릭 시 마지막 1회만 API 호출)
- [ ] 키보드 탭 이동 + Focus ring 가시 (WCAG AA)
- [ ] CollectionInfoBar에 각 컬렉션 point 수 표시

### TREND-01 트렌드 예측 알림 (`/trends`)

- [ ] `/trends` 접속 시 `GET /api/v1/aggregations/trend-alert` 호출
- [ ] 카드 정렬: critical → warning 순 확인
- [ ] SeverityFilterBar: "전체" / "warning" / "critical" 필터 동작 + URL `?severity=` 파라미터 연동
- [ ] `llm_prediction` → `whitespace-pre-wrap` 평문 렌더링
- [ ] `llm_summary` → `line-clamp-3` 적용 확인
- [ ] "시스템 상세 보기" 링크 → `/dashboard/{system_id}` 이동
- [ ] critical 건수 > 0 → CriticalTrendBanner 표시 (`role="alert"` 확인)
- [ ] `uiStore.criticalCount` 업데이트 → AppLayout CriticalBanner 연동 확인
- [ ] 데이터 없음 → EmptyState "현재 임박한 장애 예측이 없습니다"
- [ ] RefreshIndicator: "5분 자동 갱신" 텍스트 + 마지막 갱신 시각 표시
- [ ] `refetchInterval: 300_000` 동작 (Network 탭: 5분마다 API 재호출 확인)
- [ ] 키보드 탭 이동 + Focus ring 가시 (WCAG AA)

### 공통

- [ ] `npm run build` 오류 없음
- [ ] Lighthouse Accessibility 90점 이상 유지
- [ ] 모든 신규 페이지 LLM 텍스트 `dangerouslySetInnerHTML` 미사용 검증 (코드 리뷰)
- [ ] WCAG AA: 보조 텍스트 `#4A5568` 대비 4.6:1 준수
- [ ] Focus ring: `focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2` 모든 인터랙티브 요소에 적용
