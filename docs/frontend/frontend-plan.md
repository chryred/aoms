# Synapse-V 프론트엔드 UI 구현 계획

## Context

Synapse-V(백화점 통합 모니터링 시스템)의 관리자/사용자 페이지를 React + shadcn/ui + Tailwind CSS로 신규 구현한다.
- API: admin-api(8080) 전체 + log-analyzer(8000)의 Qdrant 검색 엔드포인트 활용
- 디자인: 뉴모피즘 카드 + 글라스모피즘 버튼 + Pretendard 폰트
- 위치: `main-server/services/frontend/` (Main Server A, services 레벨)
- 배포: nginx 리버스 프록시를 통해 단일 origin으로 admin-api / log-analyzer 프록시

---

## 배포 구성 (Main Server A)

```
Main Server (A)
  ├── nginx
  │     ├── /                → frontend 정적 파일 (dist/)
  │     ├── /api/            → proxy → admin-api:8080
  │     ├── /analyze/        → proxy → log-analyzer:8000
  │     └── /aggregation/    → proxy → log-analyzer:8000
  ├── services/
  │   ├── admin-api/
  │   ├── log-analyzer/
  │   └── frontend/          ← 신규 (빌드 결과 nginx로 서빙)
  └── docker-compose.yml     ← frontend 서비스 추가
```

### docker-compose.yml 추가 서비스
```yaml
frontend:
  image: aoms-frontend:latest
  build:
    context: ./services/frontend
    dockerfile: Dockerfile
  volumes:
    - ./services/frontend/dist:/usr/share/nginx/html:ro
  ports:
    - "3000:80"
  depends_on:
    - admin-api
    - log-analyzer
```

> nginx 리버스 프록시로 동일 origin 처리 → CORS 문제 없음, 브라우저 인증 쿠키도 동일 도메인 적용.

---

## 환경 구성 (보안 검토 반영 버전)

### 핵심 의존성 보안 판단

| 패키지 | 보안 상태 | 결정 |
|---|---|---|
| **React 19** | ❌ CVE-2025-55182 (CVSS 10.0, RSC RCE) | **React 18 유지** |
| **React 18.x** | ✅ RSC 미사용 SPA → CVE 비해당 | 채택 |
| **ky** | ✅ native Fetch 기반, 의존성 0개, sindresorhus 관리 | 채택 |
| **Vite 6.x** | ✅ RSC 플러그인 아닌 일반 Vite, 취약점 비해당 | 채택 |
| **@tanstack/react-query v5** | ✅ 알려진 취약점 없음 | 채택 |
| **zustand 5.x** | ✅ 알려진 취약점 없음 | 채택 |
| **recharts 2.x** | ✅ 알려진 취약점 없음 | 채택 |
| **shadcn/ui** | ✅ 코드 복사 방식, npm 의존성 최소 | 채택 |

### 최종 패키지 버전 (핀 고정)

| 패키지 | 권장 버전 | 비고 |
|---|---|---|
| **Node.js** | 22.x LTS | 권장 |
| **React + React DOM** | `18.3.1` | React 19 RSC 취약점 회피 |
| **Vite** | `6.3.x` | `@vitejs/plugin-react` |
| **TypeScript** | `5.7.x` | strict mode |
| **Tailwind CSS** | `4.1.x` | `@tailwindcss/vite` (postcss 불필요) |
| **shadcn/ui** | `shadcn@latest` | `npx shadcn@latest init -t vite` |
| **@tanstack/react-query** | `5.90.x` | devtools 포함 |
| **React Router DOM** | `7.5.x` | |
| **ky** | `1.7.x` | Fetch 기반, 의존성 0개 |
| **zustand** | `5.0.x` | auth 상태 |
| **recharts** | `2.15.x` | 시계열 차트 |
| **lucide-react** | `0.511.x` | shadcn 기본 아이콘 |
| **react-hot-toast** | `2.5.x` | 전역 토스트 |

> **버전 고정 원칙**: `package.json`에서 `^` (caret) 범위 금지, 정확한 버전(`"1.7.2"`)으로 고정.
> CI에서는 `npm install` 대신 **`npm ci`** 사용 (lockfile 강제 준수).

### 초기화 명령어 순서
```bash
# main-server/services/ 위치에서 실행
npm create vite@latest frontend -- --template react-ts
cd frontend

# React 18 정확한 버전 고정 (React 19 RSC 취약점 회피)
npm install react@18.3.1 react-dom@18.3.1

# Tailwind CSS v4 + Vite 플러그인 (postcss 없이)
npm install tailwindcss@4.1.4 @tailwindcss/vite@4.1.4

# shadcn/ui 초기화 (Vite 템플릿)
npx shadcn@latest init -t vite

# 주요 의존성
npm install @tanstack/react-query@5.90.3 @tanstack/react-query-devtools@5.90.3
npm install react-router-dom@7.5.3
npm install ky@1.7.2
npm install zustand@5.0.3
npm install recharts@2.15.3
npm install react-hot-toast@2.5.2
npm install lucide-react

# 개발 의존성
npm install --save-dev @types/node prettier prettier-plugin-tailwindcss

# 설치 후 보안 감사 (필수)
npm audit
```

### ky 클라이언트 패턴 (`src/lib/ky-client.ts`)

```ts
import ky from 'ky'
import { authStore } from '@/store/authStore'

const commonHooks = {
  beforeRequest: [
    (req: Request) => {
      const token = authStore.getState().token
      if (token) req.headers.set('Authorization', `Bearer ${token}`)
    }
  ],
  afterResponse: [
    async (_req: Request, _opts: unknown, res: Response) => {
      if (res.status === 401) {
        authStore.getState().logout()
        window.location.href = '/login'
      }
    }
  ]
}

export const adminApi = ky.create({
  prefixUrl: import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:8080',
  hooks: commonHooks,
  timeout: 10_000,
})

export const logAnalyzerApi = ky.create({
  prefixUrl: import.meta.env.VITE_LOG_ANALYZER_URL ?? 'http://localhost:8000',
  hooks: commonHooks,
  timeout: 10_000,
})
```

### vite.config.ts 핵심 설정
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/analyze': 'http://localhost:8000',
      '/aggregation': 'http://localhost:8000',
    }
  }
})
```

### 공급망 보안 대책
```bash
# 버전 범위 ^ 제거, 정확한 버전 사용
# BAD  : "ky": "^1.7.2"
# GOOD : "ky": "1.7.2"

# CI 파이프라인 — lockfile 강제 준수
npm ci

# 신규 패키지 추가 전 Socket.dev 스캔
npx socket npm install <package>

# 정기 보안 감사 (주 1회 권장)
npm audit --audit-level=moderate
```

### index.css (Tailwind v4 방식 — 라이트 뉴모피즘)
```css
@import "tailwindcss";
@import "tw-animate-css";

@theme inline {
  --font-sans: 'Pretendard', system-ui, sans-serif;
  /* 뉴모피즘 shadow 토큰 */
  --shadow-neu-flat: 6px 6px 12px #C8CBD4, -6px -6px 12px #FFFFFF;
  --shadow-neu-inset: inset 4px 4px 8px #C8CBD4, inset -4px -4px 8px #FFFFFF;
  --shadow-neu-pressed: inset 2px 2px 6px #C8CBD4, inset -2px -2px 6px #FFFFFF;
  /* 팔레트 3 — 라이트 뉴트럴 + 인디고 */
  --color-bg-base: #E8EBF0;
  --color-surface: #E8EBF0;
  --color-accent: #6366F1;
  --color-accent-hover: #4F46E5;
  --color-accent-muted: #EEF2FF;
  --color-text-primary: #1A1F2E;
  --color-text-secondary: #5A6072;
  --color-critical: #DC2626;
  --color-warning: #D97706;
  --color-normal: #16A34A;
}
```

---

## 레이아웃 안 3가지 비교

**✅ 안 A 채택** — 좌측 240px 고정 사이드바, collapse(64px 아이콘) 모드 지원

| | 안 A ✅ | 안 B | 안 C |
|---|---|---|---|
| 구조 | 좌측 240px 고정 사이드바 | 상단 탭 + 좌우 분할 | 허브앤스포크 + 플로팅 패널 |
| 장점 | 엔터프라이즈 친숙, 알림 배지 상시 노출, collapse 지원 | master-detail 패턴 최적 | 대시보드 몰입감 최고 |
| 단점 | 240px 고정 폭 제약 | 탭 항목 증가 시 오버플로우 | 접근성 구현 복잡 |

---

## 색상 팔레트 — 라이트 뉴트럴 + 인디고 ✅

```
Background:  #E8EBF0   Surface: #E8EBF0 (동일)
Shadow L:    #FFFFFF    Shadow D: #C8CBD4
Accent:      #6366F1   Accent Hover: #4F46E5   Accent Muted: #EEF2FF
Text:        #1A1F2E   Text Secondary: #5A6072
Critical:    #DC2626   Warning: #D97706   Normal: #16A34A
Glass BG:    rgba(99,102,241,0.10)  Glass Border: rgba(99,102,241,0.20)
```

---

## 전체 화면 목록 (20개)

### 인증 그룹
- **AUTH-01** 로그인 — 뉴모피즘 카드 중앙 배치
- **AUTH-02** 사용자 등록 신청 — 이름/이메일/소속/담당 시스템
- **AUTH-03** 사용자 승인 관리 — 신청 목록 + 승인/거부 (관리자 전용)

### 운영 대시보드
- **DASH-01** 운영 메인 — 시스템 상태 그리드 + 알림 피드 + 트렌드 배너, 1분 자동갱신
- **DASH-02** 시스템 상세 뷰 — 메트릭 차트 + [메트릭/로그/알림/담당자] 탭

### 시스템 관리
- **SYS-01** 시스템 목록 — 검색/필터 + 정렬 테이블
- **SYS-02** 시스템 등록/수정 — 사이드 Drawer 폼
- **SYS-03** 수집기 마법사 — 5단계 Step Wizard (템플릿 체크리스트)

### 담당자 관리
- **CNT-01** 담당자 목록 — 카드 그리드
- **CNT-02** 담당자 등록/수정 — 시스템 매핑 포함 폼

### 알림 이력
- **ALT-01** 알림 이력 — [메트릭] [로그분석] 탭, anomaly_type 배지, 상세 사이드패널
- **ALT-02** 알림 승인(Acknowledge) 인라인 액션

### 안정성 분석 리포트
- **RPT-01** 안정성 리포트 — 기간 토글(시/일/주/월/분기/반기/연간) + Sparkline + LLM 요약
- **RPT-02** 리포트 발송 이력 — teams_status, sent_at 기록

### 유사 장애 검색
- **SIM-01** 유사 장애 검색 — 자연어 입력 → log-analyzer `/aggregation/search`, 유사도 슬라이더

### 추가 권장 화면
- **TREND-01** 트렌드 예측 알림 — `/aggregation/trend-alert`, critical 우선 정렬
- **FEED-01** 피드백 관리 — error_type / resolver / has_solution 현황
- **COL-01** 수집기 설정 현황 — 활성화 인라인 토글
- **VEC-01** 벡터 컬렉션 상태 — `/aggregation/collections/info`, 포인트 수 카드 (관리자 전용)
- **PROFILE** 내 프로필 — 이름/이메일/API키(마스크) 수정

---

## 프로젝트 구조

```
main-server/services/frontend/
├── public/fonts/Pretendard-*.woff2
├── src/
│   ├── lib/
│   │   ├── ky-client.ts      ← adminApi / logAnalyzerApi (ky 기반)
│   │   ├── queryClient.ts    ← staleTime:30s, retry:1, refetchOnWindowFocus:false
│   │   └── utils.ts          ← cn(), formatDate(), severityColor()
│   ├── constants/
│   │   ├── queryKeys.ts      ← queryKey 팩토리
│   │   └── routes.ts
│   ├── types/                ← system, contact, alert, analysis, aggregation, report, auth
│   ├── api/                  ← systems, contacts, alerts, analysis, aggregations, reports,
│   │                            collectorConfig, logAnalyzer
│   ├── hooks/
│   │   ├── queries/          ← useSystems, useAlerts, useAggregations, useTrendAlerts...
│   │   ├── mutations/        ← useCreateSystem, useAcknowledgeAlert...
│   │   └── useAutoRefresh.ts ← 60초 주기 invalidateQueries
│   ├── store/authStore.ts    ← Zustand: user, token, login(), logout()
│   ├── components/
│   │   ├── ui/               ← shadcn/ui primitives
│   │   ├── layout/           ← AppLayout, Sidebar(collapse), TopBar, AuthLayout
│   │   ├── neumorphic/       ← NeuCard, NeuButton(glass), NeuInput, NeuGauge, NeuBadge
│   │   ├── dashboard/        ← SystemGrid, SystemCard, AlertFeed, TrendBanner
│   │   ├── system/           ← SystemTable, SystemFormDrawer, CollectorWizard, MetricChart
│   │   ├── alert/            ← AlertTable, AlertDetailPanel, AnomalyTypeBadge
│   │   ├── report/           ← AggregationView, PeriodToggle, ReportHistoryTable
│   │   ├── search/           ← SimilarSearchInput, SimilarResultCard
│   │   └── common/           ← PageHeader, EmptyState, LoadingSkeleton, DataTable
│   └── pages/                ← auth/, DashboardPage, system/, contact/,
│                                AlertHistoryPage, report/, SimilarSearchPage,
│                                TrendAlertPage, FeedbackManagementPage, VectorHealthPage
├── Dockerfile
├── components.json           ← shadcn/ui 설정
├── vite.config.ts
└── package.json
```

---

## API 연동 전략

### ky 클라이언트 (`src/lib/ky-client.ts`)
- `adminApi`: `VITE_ADMIN_API_URL` (기본 `http://localhost:8080`)
- `logAnalyzerApi`: `VITE_LOG_ANALYZER_URL` (기본 `http://localhost:8000`)
- beforeRequest hook: `Authorization: Bearer {token}` 자동 주입
- afterResponse hook: 401 → authStore.logout() + `/login` 리다이렉트

### react-query 설정
- `staleTime: 30_000` / `gcTime: 300_000` / `retry: 1`
- 대시보드 시스템 상태: `refetchInterval: 60_000`
- 알림 피드: `refetchInterval: 30_000`
- 유사 검색(POST): `useMutation` 사용 (검색 결과를 useState에 저장)

### 인증 전략 (단계적)
- Phase 1: `VITE_API_TOKEN` 환경변수 정적 토큰 (개발/초기 운영)
- Phase 2: admin-api에 `POST /api/v1/auth/login` 추가 후 JWT 교체
- AuthGuard: `authStore.token` 없으면 `/login` 리다이렉트, `role === 'admin'`만 접근 가능한 페이지(AUTH-03, VEC-01) 별도 가드

---

## 핵심 컴포넌트 구현 가이드

### NeuCard (뉴모피즘)
```tsx
<div className="rounded-2xl bg-[#E8EBF0] shadow-[6px_6px_12px_#C8CBD4,-6px_-6px_12px_#FFFFFF] p-6">
```

### NeuButton (글라스모피즘 — 인디고)
```tsx
<button className="
  rounded-xl px-4 py-2
  bg-[rgba(99,102,241,0.10)]
  border border-[rgba(99,102,241,0.20)]
  backdrop-blur-[8px]
  text-[#6366F1] hover:bg-[rgba(99,102,241,0.20)]
  transition-all duration-200
">
```

### AnomalyTypeBadge
```tsx
const colors = {
  duplicate: 'bg-gray-500',
  recurring: 'bg-orange-500',
  related:   'bg-blue-500',
  new:       'bg-green-500',
}
```

---

## 구현 우선순위

**Phase 1 — 핵심 운영 (필수)**
1. 프로젝트 scaffold + 환경 구성 (Vite/Tailwind v4/shadcn)
2. Pretendard 폰트 + 팔레트 토큰 + 뉴모피즘 CSS 토큰
3. AppLayout (Sidebar collapse + TopBar)
4. ky 클라이언트 + react-query 설정
5. DASH-01 운영 대시보드
6. SYS-01/02 시스템 관리
7. ALT-01 알림 이력

**Phase 2 — 확장 기능**
8. CNT-01/02 담당자 관리
9. DASH-02 시스템 상세 뷰 (recharts 통합)
10. RPT-01 안정성 분석 리포트

**Phase 3 — 고급 기능**
11. SIM-01 유사 장애 검색 (log-analyzer 연동)
12. TREND-01 트렌드 예측 알림
13. SYS-03 수집기 마법사
14. AUTH-01/02/03 인증 시스템
15. FEED-01, COL-01, VEC-01

---

## 수정 대상 파일

- **신규 생성**: `main-server/services/frontend/` 전체 디렉토리
- **수정 필요**:
  - `main-server/docker-compose.yml` — frontend 서비스 블록 추가
  - `main-server/docker-compose.dev.yml` — 로컬 개발용 프록시 설정 추가
  - `main-server/CLAUDE.md` — frontend 서비스 추가 내용 반영
- **참조 (수정 없음)**:
  - `main-server/services/admin-api/schemas.py` — TypeScript 타입 대응
  - `main-server/services/log-analyzer/main.py` — logAnalyzerApi 엔드포인트 확인

---

## UX/UI 전문가 검토 — 개선 및 추가 필요 사항

### 🔴 Critical — 반드시 수정 (기능/접근성 저해)

#### 1. 뉴모피즘 접근성 위험 (WCAG AA 위반 가능)
라이트 팔레트(`#E8EBF0` 배경)에서 그림자만으로 카드를 구분하는 뉴모피즘은 **WCAG 2.1 AA 명도 대비(4.5:1)** 를 만족하기 어렵다. 특히 disabled 버튼, 포커스 인디케이터, 입력 필드 경계선이 문제.

**개선 방향:**
- 카드 내부 텍스트 및 아이콘은 반드시 `#1A1F2E` 유지 → OK
- Interactive 요소(버튼, 입력창)에는 **최소 1px border `#C0C4CF`** 추가 — 그림자만으로 경계 표시 금지
- Focus ring: `outline: 2px solid #6366F1; outline-offset: 2px` 반드시 적용 (키보드 탐색)
- `text-[#5A6072]` 보조 텍스트 → 배경 `#E8EBF0` 대비 **3.4:1** 으로 AA 미달 → `#4A5568` 이상으로 조정
- 설계 추가: `NeuInput` 컴포넌트에 항상 테두리선 포함

#### 2. Critical 알림 시각 계층 부재
운영자가 한눈에 위험 상황을 인식해야 하는 환경에서, critical/warning/info 알림이 동일한 카드 크기·레이아웃으로 나열되면 **중요한 이벤트를 놓칠 수 있다.**

**개선 방향:**
- `severity === 'critical'` 카드: 좌측 4px border `#DC2626` + 배경 `rgba(220,38,38,0.04)` 틴트
- `severity === 'warning'` 카드: 좌측 4px border `#D97706`
- 대시보드 상단 `SystemSummaryBar`에 **critical 건수 빨간 pill** 항상 노출
- 새 critical 알림 수신 시 → 화면 상단 **전역 배너** (어떤 페이지에 있어도 노출, 클릭 시 ALT-01 이동)

#### 3. 전역 빠른 검색(Cmd+K) 부재
13개 시스템 + 수백 개 알림에서 이름으로 즉시 이동하는 **Command Palette** 없음. 운영 속도를 크게 저하시킨다.

**개선 방향:**
- `components/common/CommandPalette.tsx` 추가 (`cmdk` 패키지, shadcn/ui Command 기반)
- 단축키 `Cmd+K` / `Ctrl+K` 트리거
- 검색 대상: 시스템명, 알림 이력, 페이지 이동
- Sidebar 상단에 검색 아이콘 배치 (collapse 시 아이콘만)

---

### 🟡 High — 강력 권장 (UX 완성도)

#### 4. Empty State 전략 미정의
초기 설치 직후 데이터가 없는 화면(시스템 0개, 알림 0건 등)에 대한 가이드가 없어 신규 사용자가 혼란스럽다.

**추가 필요 컴포넌트 `EmptyState.tsx`:**
- 일러스트 + 제목 + 설명 + CTA 버튼 조합
- 화면별 맞춤 메시지: "시스템을 등록해주세요 → [시스템 등록]", "알림 이력이 없습니다"

#### 5. 파괴적 액션 확인 다이얼로그 미명시
시스템 삭제, 담당자 제거, 수집기 비활성화 같은 **되돌릴 수 없는 액션**에 대한 `ConfirmDialog` 패턴이 명시되지 않았다.

**개선 방향:**
- `ConfirmDialog.tsx`는 계획에 있으나 각 화면에서 언제 쓰는지 명시 추가
- 삭제 버튼: Danger 스타일(`text-[#DC2626]`) + ConfirmDialog ("시스템명을 입력해서 확인")
- SYS-01, CNT-01, COL-01 모든 삭제 액션에 적용

#### 6. 타임존·시간 표시 전략 미정의
Synapse-V는 백화점 운영 환경으로 KST(UTC+9) 기준. 현재 계획에 시간 처리 전략이 없다.

**추가 필요:**
- `utils.ts`에 `formatKST(utcDate)` 유틸 추가 → 모든 시간 표시를 KST 절대시간으로 통일
- 1시간 이내: **상대 시간** ("3분 전") + hover 시 KST 절대 시간 tooltip
- 1시간 이후: KST 절대 시간 ("2026-04-03 14:32")
- 차트 X축: KST 기준 표시

#### 7. Sidebar 그룹핑 누락
20개 화면이 섹션 구분 없이 나열되면 사이드바가 길어져 탐색이 어렵다.

**개선된 Sidebar 구조:**
```
📊 운영
   대시보드
   트렌드 예측

🔔 알림
   알림 이력
   피드백 관리

📈 분석
   안정성 리포트
   유사 장애 검색

⚙️ 관리
   시스템
   담당자
   수집기 설정

👤 계정 (하단 고정)
   내 프로필
   [관리자] 사용자 승인
   [관리자] 벡터 상태
```

#### 8. 폼 유효성 검사(Validation) 전략 미정의
SYS-02, CNT-02 등 등록/수정 폼에서 서버 에러 응답(`422 Unprocessable Entity`, FastAPI detail 배열)을 어떻게 표시할지 미정의.

**개선 방향:**
- react-hook-form + zod 추가 (타입 안전한 폼 검증)
  ```bash
  npm install react-hook-form@7.x zod@3.x @hookform/resolvers@3.x
  ```
- 서버 에러: `detail[].loc` 기반으로 해당 필드 아래 inline 에러 표시
- 성공 시: react-hot-toast ("시스템이 등록되었습니다")

#### 9. 데이터 테이블 UX 요소 누락
ALT-01, SYS-01 등 테이블에서 필요한 요소가 계획에 없다.

**DataTable에 반드시 포함:**
- 컬럼 정렬 (클릭 토글 ▲▼)
- 페이지네이션 (서버사이드, `limit` + `offset` 파라미터 기반)
- 행 선택 (체크박스) → 일괄 Acknowledge
- CSV 내보내기 버튼 (알림 이력, 분석 이력)
- 필터 초기화 버튼

#### 10. 차트 인터랙션 전략 미정의
DASH-02 시스템 상세 차트(recharts)에서 특정 시점 클릭 시 해당 시간대 알림을 연결하는 드릴다운이 없다.

**개선 방향:**
- `MetricChart` 포인트 클릭 → 해당 `hour_bucket` 기준 알림 이력 필터링하여 하단 탭 자동 이동
- Tooltip에 해당 시점 `llm_severity` 배지 + `llm_prediction` 텍스트 표시

---

### 🟢 Medium — 권장 개선 (완성도 향상)

#### 11. 로딩·에러 상태 패턴 체계화
현재 `LoadingSkeleton`만 명시. 각 상황별 패턴을 정의해야 한다.

| 상황 | 컴포넌트 |
|---|---|
| 페이지 첫 로드 | `LoadingSkeleton` (카드/테이블 shape 맞춤) |
| 버튼 액션 중 | 버튼 내 `Loader2` 스피너 (shadcn/ui) + 비활성화 |
| API 에러 (500/503) | `ErrorBoundary` 카드 (재시도 버튼 포함) |
| 네트워크 끊김 | 상단 연결 끊김 배너 (노란색) |
| 데이터 0건 | `EmptyState` 컴포넌트 |

#### 12. Toast 위치 충돌 방지
`react-hot-toast` 기본 위치가 우측 상단인데, 알림 피드(AlertFeed)가 대시보드 우측에 배치되어 **겹침** 발생 가능.

**개선 방향:** `<Toaster position="bottom-right" />` 로 변경, 또는 대시보드에서만 `position="top-center"` 로 오버라이드

#### 13. 다크 모드 토글 (야간 운영 대응)
백화점 운영은 24시간이므로 야간 운영자를 위한 다크 모드가 유용하다. 라이트/다크 두 팔레트를 CSS 변수로 준비.

**방향:** `ThemeProvider` + `localStorage` 유지. 사이드바 하단에 토글 아이콘. 다크 토큰은 팔레트 2(미드나이트 슬레이트)를 재활용.

#### 14. 페이지별 `<title>` 및 Favicon
현재 미정의. 운영자가 탭을 여러 개 열어 두는 환경에서 필수.

```tsx
// 각 Page에서
useEffect(() => {
  document.title = `Synapse-V | 운영 대시보드`
}, [])
```
- Favicon: Synapse-V 로고 (16×16, 32×32 SVG)
- Critical 알림 있을 때 탭 제목에 `(🔴 3)` 표시

#### 15. Makefile에 frontend 명령 추가
현재 `make dev-up`, `make run-api`, `make run-analyzer`만 있고 frontend가 없다.

```makefile
run-frontend:
    cd main-server/services/frontend && npm run dev

build-frontend:
    cd main-server/services/frontend && npm run build
```

---

### 추가 필요 패키지 (위 개선사항 반영)

| 패키지 | 버전 | 용도 |
|---|---|---|
| **react-hook-form** | `7.54.x` | 폼 상태 관리 |
| **zod** | `3.24.x` | 스키마 기반 폼 유효성 검사 |
| **@hookform/resolvers** | `3.10.x` | zod ↔ react-hook-form 연결 |
| **cmdk** | `1.0.x` | Command Palette (shadcn/ui Command 내부 사용) |
| **date-fns** | `3.6.x` | KST 시간 포맷팅, 상대 시간 |

---

---

## 전문가 병렬 검토 결과 — 반영 사항

### 🔴 아키텍처 전문가 지적 (Critical/High)

**A1. Dockerfile 멀티스테이지 빌드 — 폐쇄망 호환**
```dockerfile
# Stage 1: Build (node:22-alpine — musl libc, glibc 비의존)
FROM node:22-alpine AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci && npm cache clean --force
COPY . .
RUN npm run build

# Stage 2: Serve (nginx:1.27-alpine)
FROM nginx:1.27-alpine
COPY --from=builder /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
USER nginx
HEALTHCHECK --interval=30s CMD wget -q --spider http://localhost/health || exit 1
EXPOSE 80
```

**A2. Node.js 버전 고정 파일 추가**
- `main-server/services/frontend/.nvmrc` → `22.0.0`
- `package.json` `engines: { "node": "22.x", "npm": ">=10.0.0" }`

**A3. Makefile 통합 — frontend 명령 추가**
```makefile
FRONTEND_DIR := $(MAIN_SERVER)/services/frontend

install-frontend:
    cd $(FRONTEND_DIR) && npm ci

run-frontend:
    cd $(FRONTEND_DIR) && npm run dev

build-frontend:
    cd $(FRONTEND_DIR) && npm run build
```

**A4. react-query 캐시 전략 데이터별 분화**
```typescript
// 알림 (변화 빠름): staleTime 5s, refetchInterval 30s
// 시스템 목록 (변화 드문): staleTime 60s, refetchInterval 300s
// 집계 (1시간 단위): staleTime 3600s, refetchInterval false
```

**A5. ky 타임아웃 분리**
- 일반 목록 API: `timeout: 5_000`
- 검색/분석 API: `timeout: 15_000`

**A6. .env.example 파일 추가**
```
# main-server/services/frontend/.env.example
VITE_ADMIN_API_URL=http://localhost:8080
VITE_LOG_ANALYZER_URL=http://localhost:8000
```

---

### 🔴 백엔드 전문가 지적 (Critical/High)

**B1. admin-api에 `offset` 파라미터 추가 필요** (현재 alerts, analysis 엔드포인트에 없음)
- DataTable 서버사이드 페이지네이션을 위해 admin-api PR 필요 → `프론트 구현 전 백엔드 선행`

**B2. TypeScript 타입 자동 동기화 — openapi-typescript 도입**
```bash
npm install -D openapi-typescript
# package.json scripts에 추가
"gen:types": "openapi-typescript http://localhost:8080/openapi.json -o src/types/api.gen.ts"
```
수동 타입 관리 금지 → 스키마 기반 자동 생성

**B3. metrics_json 파싱 레이어 신규 생성**
```typescript
// src/lib/metrics-transform.ts
export function transformMetricsToChartData(aggregations: HourlyAggregation[]): ChartDataPoint[] {
  return aggregations.map(agg => ({
    timestamp: agg.hour_bucket,
    ...JSON.parse(agg.metrics_json),  // CPU, MEM, DISK 파싱
  }))
}
```

**B4. ky afterResponse — 422 에러 필드별 파싱 추가**
```typescript
afterResponse: [
  async (_req, _opts, res) => {
    if (res.status === 401) { authStore.getState().logout(); window.location.href = '/login' }
    if (res.status === 422) {
      const data = await res.clone().json()
      const fieldErrors: Record<string, string> = {}
      data.detail?.forEach((err: any) => {
        const field = err.loc?.[1]
        if (field) fieldErrors[field] = err.msg
      })
      throw Object.assign(new Error('Validation Error'), { fieldErrors })
    }
  }
]
```

**B5. 유사 검색 URL 상태 관리 — useSearchParams 적용**
```typescript
// SIM-01: 검색어를 URL query string에 반영
const [searchParams, setSearchParams] = useSearchParams()
// 검색 시: setSearchParams({ q: query })
// 공유 가능한 URL: /search?q=high+memory+usage
```

**B6. react-hook-form + zod 패키지 추가 (폼 검증)**
```bash
npm install react-hook-form@7.54.x zod@3.24.x @hookform/resolvers@3.10.x
```

---

### 🔴 보안 전문가 지적 (Critical)

**S1. [즉시] VITE_API_TOKEN 환경변수 절대 사용 금지**
- Vite `VITE_*` 변수는 빌드 번들에 평문 포함됨 → 토큰 노출
- **Phase 1부터 백엔드 로그인 엔드포인트 구현 필수**
```python
# admin-api에 신규 추가 (Phase 1 구현 전 선행)
POST /api/v1/auth/login  → JWT accessToken 발급
POST /api/v1/auth/refresh → refreshToken(httpOnly 쿠키) → 새 accessToken
POST /api/v1/auth/logout
```

**S2. JWT 저장 전략**
- accessToken: Zustand(메모리) — XSS 안전
- refreshToken: `httpOnly; Secure; SameSite=strict` 쿠키 — CSRF 방지
- accessToken 만료: 15분 / refreshToken 만료: 7일

**S3. [즉시] admin-api CORS 설정 수정 필요**
```python
# 현재: allow_origins=["*"] → 변경 필요
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://aoms.company.com", "http://localhost:5173"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=True,
)
```

**S4. LLM 생성 텍스트 렌더링 원칙**
```tsx
// ❌ 절대 금지
<div dangerouslySetInnerHTML={{ __html: analysis_result }} />
// ✅ 항상 평문
<p className="whitespace-pre-wrap">{analysis_result}</p>
```

**S5. nginx 보안 헤더 추가**
```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; frame-ancestors 'none';" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
server_tokens off;
```

**S6. [즉시] 백엔드 관리자 권한 검사 추가 필요**
- 프론트 `role === 'admin'` 체크는 UX 전용 — 보안 아님
- admin-api에 `require_admin` Dependency 신규 구현 필요 (백엔드 선행 작업)

**S7. Rate Limiting — 검색 debounce**
```typescript
// SIM-01 검색 버튼: debounce 500ms + isPending 중 비활성화
const debouncedSearch = debounce((q: string) => mutation.mutate(q), 500)
```

**S8. Dockerfile 보안**
- non-root user (`USER nginx`) 실행
- `read_only: true` + `tmpfs` 마운트
- `.dockerignore`에 `.env.local`, `node_modules`, `dist` 포함

**S9. 민감 필드 마스킹**
- `contacts.llm_api_key`: 백엔드에서 첫 3자리만 반환 (`sk-***`)
- `contacts.teams_upn`: 목록에서 일부 마스킹

---

### 추가 패키지 (검토 결과 반영)

| 패키지 | 버전 | 용도 |
|---|---|---|
| **react-hook-form** | `7.54.x` | 폼 상태 + 서버 에러 바인딩 |
| **zod** | `3.24.x` | 스키마 기반 유효성 검사 |
| **@hookform/resolvers** | `3.10.x` | zod ↔ react-hook-form 연결 |
| **cmdk** | `1.0.x` | Command Palette (Cmd+K) |
| **date-fns** | `3.6.x` | KST 시간 포맷팅, 상대 시간 |
| **openapi-typescript** | `7.x` | Pydantic → TS 타입 자동 생성 |
| **lodash-es** | `4.x` | debounce (검색 rate limit) |

---

### 백엔드 선행 작업 목록 (프론트 구현 전 필수)

| # | 작업 | 파일 | 우선도 |
|---|---|---|---|
| 1 | `POST /api/v1/auth/login` 엔드포인트 추가 | `admin-api/routes/auth.py` (신규) | Critical |
| 2 | `POST /api/v1/auth/refresh` + `logout` | `admin-api/routes/auth.py` | Critical |
| 3 | `require_admin` Dependency 구현 | `admin-api/routes/auth.py` | Critical |
| 4 | CORS `allow_origins=["*"]` → 특정 도메인으로 수정 | `admin-api/main.py:27` | Critical |
| 5 | alerts/analysis GET에 `offset` 파라미터 추가 | `admin-api/routes/alerts.py` | High |
| 6 | `contacts.llm_api_key` 마스킹 응답 | `admin-api/schemas.py` | Medium |

---

## 검증 방법

1. `npm run dev` → `http://localhost:5173` 접근 확인
2. `make dev-up` 후 `POST /api/v1/auth/login` → JWT 수신 확인
3. 뉴모피즘 shadow: DevTools → Computed에서 `box-shadow` 적용 확인
4. 글라스모피즘 버튼: `backdrop-filter: blur(8px)` 렌더링 확인
5. 알림 피드 30초 자동 갱신: Network 탭에서 반복 요청 확인
6. log-analyzer 유사 검색: `POST /aggregation/search` 응답 카드 렌더링 확인
7. AuthGuard: 토큰 없이 `/dashboard` 접근 시 `/login` 리다이렉트 확인
8. DevTools Application → Cookies에서 `refresh_token`이 httpOnly 확인
9. `npm audit --audit-level=high` 통과 확인
10. Lighthouse → Security 탭에서 CSP, HSTS 헤더 확인
