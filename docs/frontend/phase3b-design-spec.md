# AOMS Frontend — Phase 3b 상세 설계 명세서

> `frontend-design-spec.md` + `phase2-design-spec.md` 기반. Phase 3b 구현 계약서.
> 구현 전 반드시 이 문서를 전체 숙지할 것.

---

## 0. 전제 조건 (Phase 1, 2 완료 확인)

Phase 3b 시작 전 다음이 모두 완료되어 있어야 한다.

| 항목 | 확인 방법 |
|---|---|
| Phase 1 전체 완료 (AppLayout, Auth, DASH-01, SYS-01/02, ALT-01) | `/systems` 접속 → 목록 출력 확인 |
| **SYS-01 완료** (시스템 목록 DataTable) | `/systems` 접속 |
| **SYS-02 완료** (시스템 등록/수정 폼) | `/systems/new`, `/systems/:id/edit` 접속 |
| Phase 2 전체 완료 (CNT, DASH-02, RPT) | `/contacts`, `/dashboard/:systemId` 접속 |
| `src/api/collectorConfig.ts` 미존재 또는 stub 상태 | `ls src/api/` |
| `src/types/collectorConfig.ts` 미존재 또는 stub 상태 | `ls src/types/` |

> **SYS-03는 SYS-02에서 진입한다**: `/systems/:id/edit` 페이지에서 "수집기 추가" 버튼 클릭 → `/systems/:id/wizard`로 이동.

---

## 1. Phase 3b 범위

| ID | 경로 | 설명 |
|---|---|---|
| SYS-03 | `/systems/:id/wizard` | 수집기 마법사 (5단계 Step Wizard) |
| COL-01 | `/collector-configs` | 수집기 설정 현황 (시스템별 그룹핑) |

---

## 2. 디렉토리 구조 추가분

Phase 2 구조에서 아래 파일/폴더를 추가한다.

```
src/
├── types/
│   └── collectorConfig.ts          ← 신규
├── api/
│   └── collectorConfig.ts          ← 신규
├── hooks/
│   ├── queries/
│   │   ├── useCollectorConfigs.ts  ← 신규
│   │   └── useCollectorTemplates.ts← 신규
│   └── mutations/
│       ├── useCreateConfig.ts      ← 신규
│       ├── useUpdateConfig.ts      ← 신규 (enabled 토글 포함)
│       └── useDeleteConfig.ts      ← 신규
├── store/
│   └── wizardStore.ts              ← 신규 (Zustand local state)
├── components/
│   └── collector/
│       ├── CollectorTypeCard.tsx   ← 신규 (Step 1 카드)
│       ├── MetricGroupChecklist.tsx← 신규 (Step 2)
│       ├── WizardProgress.tsx      ← 신규 (단계 표시)
│       ├── WizardStepLayout.tsx    ← 신규 (이전/다음 버튼 래퍼)
│       ├── CollectorConfigCard.tsx ← 신규 (COL-01 카드)
│       └── EnabledToggle.tsx       ← 신규 (optimistic toggle)
└── pages/
    ├── CollectorWizardPage.tsx     ← 신규 (SYS-03)
    └── CollectorConfigListPage.tsx ← 신규 (COL-01)
```

---

## 3. TypeScript 타입 정의

### 3.1 `src/types/collectorConfig.ts` (신규)

실제 DB 모델(`SystemCollectorConfig`) 및 Pydantic 스키마(`CollectorConfigCreate`, `CollectorConfigOut`, `CollectorConfigUpdate`)에서 도출.

```typescript
// collector_type 리터럴 유니온 (DB 컬럼: collector_type VARCHAR(50))
export type CollectorType =
  | 'node_exporter'
  | 'jmx_exporter'
  | 'db_exporter'
  | 'custom'

// CollectorConfigOut 스키마 대응
export interface CollectorConfig {
  id: number
  system_id: number
  collector_type: CollectorType
  metric_group: string           // cpu | memory | disk | network | system | jvm_heap | thread_pool | request | connection_pool | db_connections | db_query | db_cache | db_replication | custom | ...
  enabled: boolean
  prometheus_job: string | null  // Prometheus job label (쿼리 범위 한정)
  custom_config: string | null   // JSON string (선택적 고급 설정)
  created_at: string             // ISO 8601 UTC
  updated_at: string             // ISO 8601 UTC
}

// CollectorConfigCreate 스키마 대응 (POST body)
export interface CollectorConfigCreate {
  system_id: number
  collector_type: CollectorType
  metric_group: string
  enabled?: boolean              // 기본값 true
  prometheus_job?: string
  custom_config?: string         // JSON string
}

// CollectorConfigUpdate 스키마 대응 (PATCH body)
export interface CollectorConfigUpdate {
  enabled?: boolean
  prometheus_job?: string
  custom_config?: string
}

// GET /api/v1/collector-config/templates/{type} 응답 대응
export interface CollectorTemplateItem {
  metric_group: string
  description: string
}

export interface CollectorTemplate {
  collector_type: CollectorType
  metric_groups: CollectorTemplateItem[]
}

// 수집기 타입별 UI 메타데이터 (선택 카드 표시용)
export interface CollectorTypeOption {
  value: CollectorType
  label: string
  description: string
  iconName: string   // lucide-react 아이콘 이름
}

// Wizard 입력 상태 (Zustand store)
export interface WizardState {
  systemId: number | null
  step: 1 | 2 | 3 | 4 | 5
  // Step 1
  collectorType: CollectorType | null
  // Step 2
  selectedMetricGroups: string[]   // 체크박스 선택 목록
  customMetricGroup: string        // 커스텀 입력 텍스트 (아직 추가되지 않은 값)
  // Step 3
  prometheusJob: string
  // Step 4
  customConfig: string             // JSON 문자열 (빈 문자열이면 null로 전송)
  // actions
  setStep: (step: WizardState['step']) => void
  setCollectorType: (type: CollectorType) => void
  toggleMetricGroup: (group: string) => void
  addCustomMetricGroup: (group: string) => void
  removeMetricGroup: (group: string) => void
  setPrometheusJob: (job: string) => void
  setCustomConfig: (config: string) => void
  reset: (systemId?: number) => void
}
```

---

## 4. API 레이어

### 4.1 `src/api/collectorConfig.ts` (신규)

실제 라우터 파일(`routes/collector_config.py`)에서 확인한 엔드포인트 경로를 정확히 사용한다.

```typescript
import { adminApi } from '@/lib/ky-client'
import type {
  CollectorConfig,
  CollectorConfigCreate,
  CollectorConfigUpdate,
  CollectorTemplate,
  CollectorType,
} from '@/types/collectorConfig'

export interface CollectorConfigFilterParams {
  system_id?: number
  collector_type?: CollectorType
}

export const collectorConfigApi = {
  // GET /api/v1/collector-config?system_id=&collector_type=
  getConfigs: (params?: CollectorConfigFilterParams) =>
    adminApi.get('api/v1/collector-config', {
      searchParams: (params ?? {}) as Record<string, string | number>,
    }).json<CollectorConfig[]>(),

  // POST /api/v1/collector-config  (201 Created)
  createConfig: (body: CollectorConfigCreate) =>
    adminApi.post('api/v1/collector-config', { json: body })
      .json<CollectorConfig>(),

  // PATCH /api/v1/collector-config/{config_id}
  updateConfig: (id: number, body: CollectorConfigUpdate) =>
    adminApi.patch(`api/v1/collector-config/${id}`, { json: body })
      .json<CollectorConfig>(),

  // DELETE /api/v1/collector-config/{config_id}  (200 { deleted: true, id })
  deleteConfig: (id: number) =>
    adminApi.delete(`api/v1/collector-config/${id}`)
      .json<{ deleted: boolean; id: number }>(),

  // GET /api/v1/collector-config/templates/{collector_type}
  getTemplates: (type: CollectorType) =>
    adminApi.get(`api/v1/collector-config/templates/${type}`)
      .json<CollectorTemplate>(),
}
```

> **주의**: `getTemplates` 경로 `/api/v1/collector-config/templates/{collector_type}` 는
> `list_collector_configs` 경로 `/api/v1/collector-config` 와 prefix가 동일하다.
> FastAPI 라우터에서 `/templates/{collector_type}` 가 `/{config_id}` 보다 먼저 등록되어 있으므로
> 프론트엔드 경로 순서는 무관하다.

---

## 5. React Query 훅

### 5.1 `src/constants/queryKeys.ts` 추가분

기존 `qk` 객체에 다음을 추가한다.

```typescript
// 기존 qk 객체에 추가
collectorConfigs: (params?: CollectorConfigFilterParams) =>
  ['collector-configs', params] as const,

collectorTemplates: (type: CollectorType) =>
  ['collector-templates', type] as const,
```

### 5.2 `src/hooks/queries/useCollectorConfigs.ts`

```typescript
import { useQuery } from '@tanstack/react-query'
import { collectorConfigApi, type CollectorConfigFilterParams } from '@/api/collectorConfig'
import { qk } from '@/constants/queryKeys'

export function useCollectorConfigs(params?: CollectorConfigFilterParams) {
  return useQuery({
    queryKey: qk.collectorConfigs(params),
    queryFn: () => collectorConfigApi.getConfigs(params),
    staleTime: 60_000,   // 수집기 설정은 자주 바뀌지 않음
  })
}
```

### 5.3 `src/hooks/queries/useCollectorTemplates.ts`

```typescript
import { useQuery } from '@tanstack/react-query'
import { collectorConfigApi } from '@/api/collectorConfig'
import { qk } from '@/constants/queryKeys'
import type { CollectorType } from '@/types/collectorConfig'

export function useCollectorTemplates(type: CollectorType | null) {
  return useQuery({
    queryKey: qk.collectorTemplates(type!),
    queryFn: () => collectorConfigApi.getTemplates(type!),
    staleTime: 3_600_000,  // 템플릿은 배포 전까지 변하지 않음
    enabled: type !== null,
  })
}
```

### 5.4 뮤테이션 훅

```typescript
// src/hooks/mutations/useCreateConfig.ts
export function useCreateConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CollectorConfigCreate) =>
      collectorConfigApi.createConfig(body),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['collector-configs'] })
      toast.success('수집기 설정이 등록되었습니다')
    },
    onError: () => {
      toast.error('수집기 설정 등록에 실패했습니다')
    },
  })
}

// src/hooks/mutations/useUpdateConfig.ts
// enabled 토글에도 동일 훅 사용 (body: { enabled: boolean })
export function useUpdateConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: CollectorConfigUpdate }) =>
      collectorConfigApi.updateConfig(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collector-configs'] })
    },
    onError: () => {
      toast.error('수집기 설정 수정에 실패했습니다')
    },
  })
}

// src/hooks/mutations/useDeleteConfig.ts
export function useDeleteConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => collectorConfigApi.deleteConfig(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collector-configs'] })
      toast.success('수집기 설정이 삭제되었습니다')
    },
    onError: () => {
      toast.error('수집기 설정 삭제에 실패했습니다')
    },
  })
}
```

---

## 6. SYS-03 상세 설계 (`/systems/:id/wizard`)

**컴포넌트**: `src/pages/CollectorWizardPage.tsx`

### 6.1 Wizard 전체 구조

```
CollectorWizardPage
├── PageHeader
│   ├── 제목: "수집기 추가 — {system.display_name}"
│   └── breadcrumb: 시스템 관리 > {display_name} 수정 > 수집기 추가
├── WizardProgress        ← 현재 단계 / 총 5단계 표시
├── WizardBody            ← step에 따라 조건부 렌더링
│   ├── Step 1: 수집기 타입 선택
│   ├── Step 2: Metric Group 체크리스트
│   ├── Step 3: Prometheus Job 연결
│   ├── Step 4: 고급 설정 (JSON editor)
│   └── Step 5: 확인 및 저장
└── WizardStepLayout      ← 이전/다음 버튼 공통 래퍼
```

### 6.2 Zustand Wizard Store (`src/store/wizardStore.ts`)

```typescript
import { create } from 'zustand'
import type { WizardState, CollectorType } from '@/types/collectorConfig'

export const useWizardStore = create<WizardState>((set) => ({
  systemId: null,
  step: 1,
  collectorType: null,
  selectedMetricGroups: [],
  customMetricGroup: '',
  prometheusJob: '',
  customConfig: '',

  setStep: (step) => set({ step }),
  setCollectorType: (type) => set({ collectorType: type, selectedMetricGroups: [] }),
  toggleMetricGroup: (group) =>
    set((s) => ({
      selectedMetricGroups: s.selectedMetricGroups.includes(group)
        ? s.selectedMetricGroups.filter((g) => g !== group)
        : [...s.selectedMetricGroups, group],
    })),
  addCustomMetricGroup: (group) =>
    set((s) => ({
      selectedMetricGroups: s.selectedMetricGroups.includes(group)
        ? s.selectedMetricGroups
        : [...s.selectedMetricGroups, group],
      customMetricGroup: '',
    })),
  removeMetricGroup: (group) =>
    set((s) => ({
      selectedMetricGroups: s.selectedMetricGroups.filter((g) => g !== group),
    })),
  setPrometheusJob: (job) => set({ prometheusJob: job }),
  setCustomConfig: (config) => set({ customConfig: config }),
  reset: (systemId) =>
    set({
      systemId: systemId ?? null,
      step: 1,
      collectorType: null,
      selectedMetricGroups: [],
      customMetricGroup: '',
      prometheusJob: '',
      customConfig: '',
    }),
}))
```

> **주의**: Zustand store는 전역 상태이므로 `CollectorWizardPage` 마운트 시 반드시 `reset(systemId)` 호출.

### 6.3 Step 1 — 수집기 타입 선택

```typescript
// 타입별 카드 메타데이터
const COLLECTOR_TYPE_OPTIONS: CollectorTypeOption[] = [
  {
    value: 'node_exporter',
    label: 'Node Exporter',
    description: 'Linux/Windows 서버 CPU, 메모리, 디스크, 네트워크 메트릭 수집',
    iconName: 'Server',
  },
  {
    value: 'jmx_exporter',
    label: 'JMX Exporter',
    description: 'JEUS, Tomcat 등 JVM 기반 WAS의 Heap, GC, Thread Pool, TPS 수집',
    iconName: 'Cpu',
  },
  {
    value: 'db_exporter',
    label: 'DB Exporter',
    description: 'PostgreSQL, Oracle 등 DB의 Connection, Query, Cache 메트릭 수집',
    iconName: 'Database',
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'custom_config JSON으로 직접 수집 대상과 메트릭을 정의하는 커스텀 수집기',
    iconName: 'Settings2',
  },
]
```

**렌더링 구조:**

```
Step1Content
├── 안내 텍스트: "수집기 타입을 선택하세요"
└── 2×2 그리드 CollectorTypeCard[]
    └── CollectorTypeCard (props: option, selected, onSelect)
        ├── lucide 아이콘 (w-8 h-8)
        ├── 타입명 (bold)
        ├── 설명 텍스트 (text-[#4A5568] text-sm)
        └── 선택 시: NeuCard pressed + 체크 아이콘 (Check, w-4 h-4 text-[#6366F1])
```

**유효성 검사 (다음 단계 이동 조건):**
- `collectorType !== null`

**타입 선택 시 사이드이펙트:**
- `useCollectorTemplates(collectorType)` prefetch (다음 스텝 준비)
- `selectedMetricGroups` 초기화 (`setCollectorType` 내부에서 처리)

### 6.4 Step 2 — Metric Group 체크리스트

```
Step2Content
├── 안내 텍스트: "수집할 메트릭 그룹을 선택하세요 (최소 1개)"
├── 로딩 중: Skeleton (4~5개 체크박스 형태)
├── 템플릿 Checkbox 목록 (useCollectorTemplates 결과)
│   └── 항목마다:
│       ├── Checkbox (checked ↔ selectedMetricGroups.includes(metric_group))
│       ├── metric_group 이름 (font-medium)
│       └── description (text-[#4A5568] text-sm)
├── 구분선
└── 커스텀 추가 입력
    ├── NeuInput
    │   ├── placeholder="커스텀 metric_group 입력 (예: custom_latency)"
    │   └── value: customMetricGroup
    └── Button "추가" → addCustomMetricGroup(customMetricGroup)
        ├── 빈 문자열이면 disabled
        └── Enter 키 지원
```

**추가된 커스텀 항목 표시:**
- 템플릿에 없는 항목은 별도 "추가된 항목" 섹션에 태그 형태로 표시
- 태그마다 X 버튼 → `removeMetricGroup` 호출

**유효성 검사 (다음 단계 이동 조건):**
- `selectedMetricGroups.length >= 1`
- 미충족 시 inline 에러: "최소 1개의 메트릭 그룹을 선택해야 합니다"

### 6.5 Step 3 — Prometheus Job 연결

```
Step3Content
├── 안내 텍스트: "Prometheus job label을 입력하면 해당 job 범위 내에서만 메트릭을 조회합니다"
├── NeuInput
│   ├── label: "Prometheus Job (선택)"
│   ├── placeholder="예: node_exporter_prod, was_jmx"
│   └── value: prometheusJob
└── 힌트 텍스트 (text-[#4A5568] text-sm)
    "비워두면 시스템의 모든 Prometheus job에서 메트릭을 수집합니다.
     Prometheus job 이름은 prometheus.yml의 job_name 값과 일치해야 합니다."
```

**유효성 검사 (다음 단계 이동 조건):**
- 이 단계는 선택 사항. 빈 값도 허용. 항상 통과.

### 6.6 Step 4 — 고급 설정 (JSON editor)

```
Step4Content
├── 안내 텍스트: "수집기 동작을 세부 조정할 JSON 설정을 입력합니다 (선택)"
├── 폐쇄망 환경 안내 (InfoBanner)
│   "Monaco Editor CDN 접근 불가 환경으로 텍스트 에디터를 사용합니다."
├── textarea (NeuInput variant="textarea")
│   ├── rows={10}
│   ├── placeholder='{\n  "threshold": 80,\n  "interval": "5m"\n}'
│   ├── value: customConfig
│   ├── onChange → setCustomConfig
│   └── font-family: 'Courier New', monospace
├── JSON 유효성 검사 (실시간)
│   ├── customConfig가 빈 문자열이면 → 검사 스킵 (선택 필드)
│   ├── JSON.parse 시도
│   │   ├── 성공: inline 성공 표시 (초록 텍스트 "유효한 JSON입니다")
│   │   └── 실패: inline 에러 (빨강 텍스트 "올바른 JSON 형식이 아닙니다: {e.message}")
│   └── 에러 있을 때 "다음" 버튼 disabled
└── 빈 값 안내: "설정이 필요 없으면 비워두세요"
```

**JSON 유효성 검사 구현:**

```typescript
function validateCustomConfig(value: string): string | null {
  if (value.trim() === '') return null  // 빈 값은 유효
  try {
    JSON.parse(value)
    return null  // 에러 없음
  } catch (e) {
    return (e as Error).message
  }
}
```

**유효성 검사 (다음 단계 이동 조건):**
- `customConfig`가 빈 문자열 → 통과
- `customConfig`가 비어있지 않음 → `JSON.parse` 성공이어야 통과

### 6.7 Step 5 — 확인 및 저장

```
Step5Content
├── 안내 텍스트: "입력한 내용을 확인하고 저장하세요"
├── 요약 카드 (NeuCard)
│   ├── 행: "수집기 타입"  → collectorType 배지
│   ├── 행: "Metric Groups" → selectedMetricGroups 태그 목록
│   ├── 행: "Prometheus Job" → prometheusJob || "미설정"
│   └── 행: "고급 설정 (custom_config)"
│       ├── customConfig가 비어 있으면 → "없음"
│       └── 비어 있지 않으면 → `<pre>` 블록 (JSON.stringify(JSON.parse(v), null, 2))
│           ← prettify 표시, 최대 8줄 line-clamp + "더 보기" 토글
└── 저장 버튼 영역
    └── Button "수집기 등록" (isPending 시 spinner)
        onClick → useCreateConfig 뮤테이션 실행
```

**저장 payload 구성:**

```typescript
// metric_group은 한 번에 1개씩 POST (UniqueConstraint: system_id + collector_type + metric_group)
// selectedMetricGroups 배열을 순차적으로 POST
for (const metricGroup of selectedMetricGroups) {
  await createConfig({
    system_id: systemId,
    collector_type: collectorType,
    metric_group: metricGroup,
    prometheus_job: prometheusJob || undefined,
    custom_config: customConfig.trim() || undefined,
  })
}
```

**저장 성공 처리:**
1. `toast.success('수집기 설정 {n}개가 등록되었습니다')`
2. `wizardStore.reset()`
3. 이동: `navigate(`/systems/${systemId}/edit`)`

**저장 실패 처리:**
- 422 (UniqueConstraint 충돌): `toast.error('이미 동일한 수집기 설정이 존재합니다: {metric_group}')`
- 기타: `toast.error('수집기 설정 등록에 실패했습니다')`
- 실패한 항목은 표시 유지 (성공한 항목은 목록에서 제거)

### 6.8 WizardProgress 컴포넌트 (`src/components/collector/WizardProgress.tsx`)

```typescript
interface WizardProgressProps {
  currentStep: 1 | 2 | 3 | 4 | 5
  totalSteps?: 5
  labels?: string[]
}

const DEFAULT_LABELS = [
  '타입 선택',
  '메트릭 그룹',
  'Prometheus Job',
  '고급 설정',
  '확인 및 저장',
]
```

**렌더링:**
- 수평 스텝 표시 (원 숫자 + 선 연결)
- 완료 단계: 채워진 원 (배경 `#6366F1`, 흰색 Check 아이콘)
- 현재 단계: 테두리 원 (`border-2 border-[#6366F1]`, 숫자)
- 미완료 단계: 회색 원

### 6.9 WizardStepLayout 컴포넌트 (`src/components/collector/WizardStepLayout.tsx`)

```typescript
interface WizardStepLayoutProps {
  onPrev?: () => void         // Step 1에서는 undefined (이전 버튼 미표시)
  onNext?: () => void         // Step 5에서는 undefined (저장 버튼이 대체)
  nextDisabled?: boolean      // 현재 단계 유효성 미통과 시 true
  nextLabel?: string          // 기본: "다음" / Step 5: 저장 버튼이 별도 처리
  isPending?: boolean
  children: ReactNode
}
```

### 6.10 Wizard 공통 동작

**새로고침 경고 (`beforeunload`):**

```typescript
useEffect(() => {
  const handler = (e: BeforeUnloadEvent) => {
    // step > 1 또는 입력값이 있으면 경고
    if (step > 1 || collectorType !== null) {
      e.preventDefault()
      e.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}, [step, collectorType])
```

**취소 처리:**
- PageHeader에 "취소" 버튼 배치
- 클릭 시 `ConfirmDialog` 표시:
  - 제목: "마법사를 취소하시겠습니까?"
  - 내용: "입력 중인 내용이 초기화됩니다."
  - 확인 버튼: "취소하기" → `wizardStore.reset()` + `navigate(-1)`
  - 취소 버튼: "계속 입력"

---

## 7. COL-01 상세 설계 (`/collector-configs`)

**컴포넌트**: `src/pages/CollectorConfigListPage.tsx`

### 7.1 컴포넌트 트리

```
CollectorConfigListPage
├── PageHeader
│   ├── 제목: "수집기 설정 현황"
│   └── Button "수집기 추가" (아이콘: Plus)
│       → Sheet 또는 안내 모달:
│         "수집기는 시스템 수정 페이지에서 추가할 수 있습니다.
│          이동하려면 시스템을 선택하세요."
│         → /systems 링크
├── FilterBar
│   ├── Select: collector_type (전체 / node_exporter / jmx_exporter / db_exporter / custom)
│   └── ToggleGroup: 활성 상태 (전체 | 활성 | 비활성)
├── EmptyState (데이터 없을 때)
│   └── icon: Settings, title: "등록된 수집기 설정이 없습니다"
│       cta: { label: '시스템에서 수집기 추가', onClick: () => navigate('/systems') }
└── 시스템별 그룹 섹션 (systems × configs 클라이언트 사이드 조인)
    └── SystemGroup (시스템 수만큼 반복)
        ├── 섹션 헤더: display_name (bold) + system_name (회색 sub) + 수집기 수 배지
        └── CollectorConfigCard[] (해당 시스템의 설정들)
```

### 7.2 CollectorConfigCard 컴포넌트 (`src/components/collector/CollectorConfigCard.tsx`)

```
NeuCard
├── 좌측
│   ├── collector_type 배지 (색상 구분)
│   │   node_exporter: 파란색
│   │   jmx_exporter:  보라색
│   │   db_exporter:   초록색
│   │   custom:        회색
│   ├── metric_group (font-medium)
│   └── prometheus_job (있을 때만 표시: "Job: {value}", text-[#4A5568] text-sm)
├── 중앙
│   └── custom_config 프리뷰 (있을 때만 표시: JSON 첫 줄, max 60자 truncate)
└── 우측
    ├── EnabledToggle (enabled ↔ PATCH { enabled: !current })
    ├── Pencil 아이콘 버튼 → 수정 시트 (prometheus_job, custom_config 수정)
    └── Trash2 아이콘 버튼 → 삭제 ConfirmDialog
```

**collector_type 배지 색상:**

```typescript
const COLLECTOR_TYPE_BADGE_COLORS: Record<CollectorType, string> = {
  node_exporter: 'text-[#2563EB] bg-[rgba(37,99,235,0.1)]',
  jmx_exporter:  'text-[#7C3AED] bg-[rgba(124,58,237,0.1)]',
  db_exporter:   'text-[#059669] bg-[rgba(5,150,105,0.1)]',
  custom:        'text-[#4A5568] bg-[rgba(74,85,104,0.1)]',
}
```

### 7.3 EnabledToggle 컴포넌트 (`src/components/collector/EnabledToggle.tsx`)

Optimistic update 패턴을 적용한다.

```typescript
interface EnabledToggleProps {
  configId: number
  enabled: boolean
}

export function EnabledToggle({ configId, enabled }: EnabledToggleProps) {
  const [optimisticEnabled, setOptimisticEnabled] = useState(enabled)
  const { mutate, isPending } = useUpdateConfig()

  const handleToggle = () => {
    const newValue = !optimisticEnabled
    setOptimisticEnabled(newValue)   // 즉시 UI 변경
    mutate(
      { id: configId, body: { enabled: newValue } },
      {
        onError: () => {
          setOptimisticEnabled(enabled)  // 실패 시 롤백
          toast.error('활성화 상태 변경에 실패했습니다')
        },
      }
    )
  }

  return (
    <Switch
      checked={optimisticEnabled}
      onCheckedChange={handleToggle}
      disabled={isPending}
      aria-label={optimisticEnabled ? '수집기 비활성화' : '수집기 활성화'}
    />
  )
}
```

> `enabled` prop이 외부(React Query 캐시)에서 바뀌면 `optimisticEnabled`도 동기화해야 한다.
> `useEffect(() => setOptimisticEnabled(enabled), [enabled])` 추가 필요.

### 7.4 삭제 ConfirmDialog 내용

```
제목: "수집기 설정을 삭제하시겠습니까?"
내용: "수집기 설정을 삭제하면 해당 집계 데이터에 영향을 줄 수 있습니다.
      ({collector_type} / {metric_group})
      이 작업은 되돌릴 수 없습니다."
확인 버튼: "삭제" (빨간색, Trash2 아이콘)
취소 버튼: "취소"
```

### 7.5 데이터 조회 전략

```typescript
// 전체 수집기 설정 조회 (필터는 클라이언트 사이드)
const { data: configs } = useCollectorConfigs()

// 시스템 목록은 기존 훅 재사용
const { data: systems } = useSystems()

// 클라이언트 사이드 그룹핑
const groupedConfigs = useMemo(() => {
  if (!configs || !systems) return []
  return systems.map(system => ({
    system,
    configs: configs.filter(c => c.system_id === system.id),
  })).filter(g => g.configs.length > 0)
}, [configs, systems])

// 필터 적용
const filteredGroups = useMemo(() => {
  return groupedConfigs.map(g => ({
    ...g,
    configs: g.configs.filter(c => {
      if (filterType && c.collector_type !== filterType) return false
      if (filterEnabled === 'active' && !c.enabled) return false
      if (filterEnabled === 'inactive' && c.enabled) return false
      return true
    }),
  })).filter(g => g.configs.length > 0)
}, [groupedConfigs, filterType, filterEnabled])
```

---

## 8. 라우트 등록

`src/router.tsx` (또는 Phase 1/2에서 구성한 라우터 파일)에 추가:

```tsx
// Phase 3b 추가 라우트 (AppLayout 하위)
<Route path="systems/:id/wizard" element={<CollectorWizardPage />} />
<Route path="collector-configs" element={<CollectorConfigListPage />} />
```

**SYS-02에서 SYS-03 진입 연결:**

```tsx
// src/pages/SystemFormPage.tsx (기존 SYS-02) 수정
// 수정 모드에서만 "수집기 추가" 버튼 표시
{isEditMode && (
  <Button
    variant="outline"
    onClick={() => navigate(`/systems/${id}/wizard`)}
    className="gap-2"
  >
    <Plus className="w-4 h-4" />
    수집기 추가
  </Button>
)}
```

---

## 9. 검증 체크리스트 (Phase 3b 완료 기준)

### SYS-03 수집기 마법사

- [ ] `/systems/:id/wizard` 접속 시 WizardProgress Step 1 표시
- [ ] 타입 선택 전 "다음" 버튼 disabled 상태 확인
- [ ] 타입 카드 클릭 → 선택 상태(pressed) + Check 아이콘 표시
- [ ] Step 2: 타입 변경 시 selectedMetricGroups 초기화 확인
- [ ] Step 2: 템플릿 로드 중 Skeleton 표시
- [ ] Step 2: 커스텀 metric_group 입력 → 추가 후 태그 표시
- [ ] Step 2: 선택 0개 상태에서 "다음" 클릭 시 inline 에러 표시
- [ ] Step 4: 빈 값 → 에러 없이 다음 이동 가능
- [ ] Step 4: 잘못된 JSON 입력 → inline 에러 + "다음" disabled
- [ ] Step 4: 올바른 JSON 입력 → "유효한 JSON입니다" 표시
- [ ] Step 5: 요약 카드에 모든 입력값 반영 확인
- [ ] Step 5: "수집기 등록" 클릭 → POST 성공 → `/systems/:id/edit` 이동
- [ ] Step 5: 중복 등록(UniqueConstraint) → 에러 toast 표시
- [ ] "이전" 버튼으로 단계 역행 + 입력값 유지 확인
- [ ] 새로고침 시 `beforeunload` 경고 표시 (입력값 있을 때)
- [ ] 취소 버튼 → ConfirmDialog → 확인 시 navigate(-1)
- [ ] 취소 버튼 → ConfirmDialog → "계속 입력" 시 Wizard 유지

### COL-01 수집기 설정 현황

- [ ] `/collector-configs` 접속 시 시스템별 그룹핑 목록 출력
- [ ] 수집기 미등록 시스템은 그룹 섹션에 표시되지 않음 확인
- [ ] collector_type 필터 동작 (선택 → 해당 타입만 표시)
- [ ] 활성/비활성 필터 동작
- [ ] EnabledToggle 클릭 → 즉시 UI 토글 (optimistic update)
- [ ] EnabledToggle API 실패 → UI 롤백 + error toast
- [ ] 삭제 → ConfirmDialog 표시 → 확인 시 DELETE 요청
- [ ] 삭제 성공 → 목록에서 즉시 제거
- [ ] 데이터 없음 → EmptyState 표시 + "시스템에서 수집기 추가" CTA

### 공통

- [ ] `npm run build` 오류 없음
- [ ] Lighthouse Accessibility 90점 이상 유지
- [ ] 모든 신규 페이지 키보드 탭 이동 + Focus ring 가시
- [ ] Switch 컴포넌트 `aria-label` 상태 반영 확인
- [ ] Wizard에서 새로고침 후 Step 1 초기화 확인 (store reset)

---

## 10. 의존성 추가 없음

Phase 3b는 Phase 1/2에서 설치한 패키지만으로 구현 가능하다.

| 기능 | 사용 패키지 |
|---|---|
| JSON editor | `textarea` (폐쇄망: Monaco CDN 불가) |
| Switch/Toggle | shadcn `Switch` 컴포넌트 (Phase 1 설치분) |
| Step Wizard state | `zustand` (Phase 1 설치분) |
| 폼 유효성 검사 | `react-hook-form` + `zod` (Phase 1 설치분) |

> **폐쇄망 제약**: Monaco Editor는 CDN 의존성이 있어 폐쇄망 환경에서 사용 불가.
> `textarea`에 `font-family: monospace`를 적용하여 대체한다.
> 필요 시 향후 로컬 번들 방식으로 교체 가능하도록 `Step4Content`를 독립 컴포넌트로 분리한다.
