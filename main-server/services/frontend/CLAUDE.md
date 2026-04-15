# aoms-frontend — Claude 컨텍스트 가이드

## Project Overview

- **이름**: aoms-frontend
- **목적**: Synapse-V 백화점 통합 모니터링 시스템 관리 UI
- **대상 사용자**: 시스템 담당자, 운영팀

---

## Tech Stack

| 분류 | 라이브러리 | 버전 |
|---|---|---|
| UI | React | 18.3.1 |
| 언어 | TypeScript | 5.7.3 |
| 빌드 | Vite | 6.4.1 |
| 스타일 | TailwindCSS | 4.1.4 |
| 상태 관리 | Zustand | 5.0.3 |
| 서버 상태 | @tanstack/react-query | 5.96.2 |
| 폼 검증 | react-hook-form + zod | 7.56.4 / 3.24.4 |
| HTTP | ky | 1.7.4 |
| 차트 | recharts | 2.15.3 |
| 테스트 | Vitest + @testing-library | 4.1.2 |

---

## Directory Structure

```
src/
├── api/           # API 호출 함수 (도메인별 파일)
│   └── agents.ts      # SSH 세션 + 에이전트 CRUD + 제어 + 설치 Job (Phase 6)
├── components/
│   ├── neumorphic/    # 기본 UI 컴포넌트 (NeuCard, NeuButton, NeuInput 등)
│   ├── layout/        # AppLayout, AuthLayout, TopBar, AuthGuard
│   ├── common/        # EmptyState, LoadingSkeleton, ErrorCard, PageHeader
│   ├── dashboard/     # DashboardSummary, SystemHealthGrid, EnhancedSystemCard, AlertFeed
│   ├── alert/         # AlertTable, AlertDetailPanel, AnomalyTypeBadge
│   ├── charts/        # MetricChart, SeverityBadge
│   ├── reports/       # PeriodToggle, AggregationCard
│   ├── contacts/      # ContactForm, SystemContactPanel
│   ├── collector/     # 수집기 마법사 UI (WizardProgress, WizardStepLayout 등)
│   ├── search/        # SimilarSearchInput, SimilarResultCard
│   ├── trends/        # CriticalTrendBanner, TrendAlertCard
│   ├── system/        # SystemFormDrawer
│   ├── agent/         # SSHSessionModal, AgentCard, AgentStatusBadge, AgentFormModal, InstallJobMonitor (Phase 6)
│   └── user/
├── hooks/
│   ├── queries/       # 조회 훅 (useDashboardHealth, useSystemDetailHealth, useAgents, useAgentStatus, useAgentConfig, useInstallJob)
│   ├── mutations/     # 변경 훅
│   └── useWebSocket.ts  # WebSocket 실시간 알림 (자동 재연결, heartbeat, React Query 동기화)
├── pages/         # 라우트별 페이지 컴포넌트
│   ├── DashboardPage.tsx              # 통합 대시보드 (하이브리드: 상단 통계 + 하단 시스템 카드)
│   ├── DashboardSystemDetailPage.tsx  # 시스템 상세 (활성 알림 + 로그분석 + 담당자)
│   ├── FeedbackSubmitPage.tsx        # Teams 카드 "해결책 등록" 버튼 진입 단독 페이지 (AppLayout 외부)
│   ├── FeedbackSearchPage.tsx        # 해결책 검색 (/feedback/search, 시스템 + 원인/해결책 키워드 ILIKE)
│   ├── AgentListPage.tsx             # 에이전트 목록 (시스템별 그룹, SSH 세션 관리) (Phase 6)
│   └── AgentDetailPage.tsx           # 에이전트 제어 + 설정 파일 편집기 (Phase 6)
├── store/         # Zustand 스토어 (authStore, uiStore, wizardStore, sshSessionStore)
│   └── sshSessionStore.ts  # SSH 세션 토큰 인메모리 관리 (Phase 6)
├── types/         # TypeScript 타입 정의
│   └── agent.ts       # AgentInstance, SSHSession, InstallJob 타입 (Phase 6)
├── lib/           # queryClient, ky-client, utils, metrics-transform
└── constants/     # 앱 상수 (routes.ts에 AGENTS, agentDetail 추가)
```

---

## Commands

```bash
npm run dev           # 개발 서버 (포트 5173)
npm run build         # 타입 체크 + Vite 빌드
npm run lint          # TypeScript 타입 체크 + ESLint
npm run lint:fix      # ESLint 자동 수정
npm run format        # Prettier 포맷 적용
npm run format:check  # Prettier 포맷 검사 (CI용)
npm test              # Vitest 단위 테스트
```

## 코드 품질 도구

| 도구 | 설정 파일 | 역할 |
|---|---|---|
| ESLint | `eslint.config.js` | 코드 품질 — TypeScript, React, react-hooks, react-refresh 규칙 |
| Prettier | `.prettierrc` | 코드 포맷 — singleQuote, semi off, printWidth 100, tailwindcss 플러그인 |

**개선 작업 후 필수 실행 순서:**
```bash
npm run lint:fix   # ESLint 자동 수정 (고칠 수 있는 것 먼저)
npm run format     # Prettier 포맷 정리
npm run lint       # 최종 검사 (에러 0 확인 후 완료)
```

개발 서버 프록시:
- `/api` → `http://localhost:8080` (admin-api)
- `/analyze`, `/aggregation` → `http://localhost:8000` (log-analyzer)

---

## Conventions

- **컴포넌트**: PascalCase, 도메인 폴더 단위 분리
- **훅**: `use` 접두사, `hooks/queries/` 또는 `hooks/mutations/` 위치
- **API 함수**: `src/api/` 도메인별 파일
- **기본 UI**: `src/components/neumorphic/` 컴포넌트 우선 재사용
- **금지**: `any` 타입 사용, 미사용 변수/파라미터 (strict 모드 활성화)
- **경로 별칭**: `@/` → `./src/`

---

## Environment

```
VITE_ADMIN_API_URL       # admin-api 주소 (운영: http://admin-api:8080)
VITE_LOG_ANALYZER_URL    # log-analyzer 주소 (운영: http://log-analyzer:8000)
```

개발 환경에서는 vite.config.ts 프록시로 CORS 우회 — 환경변수 없이도 동작.

---

## Notes

- 뉴모피즘 디자인 시스템 전체 적용 — 새 컴포넌트는 반드시 `neumorphic/` 기본 컴포넌트 위에서 구성
- Collector 등록 마법사 UI 포함 (Phase 5 수집기 유연 레지스트리 연동)
- 폐쇄망 배포 시 `npm run build` 결과물을 Nginx 등으로 정적 서빙

---

## 타임존 규칙 (반복 개선 항목)

**백엔드는 모든 날짜를 naive UTC로 저장한다** (타임존 접미사 없음). 프론트엔드에서 반드시 KST(UTC+9)로 변환하여 표시해야 한다.

### 필수 사용 함수 (`src/lib/utils.ts`)

| 함수 | 용도 |
|---|---|
| `formatKST(utcDate, format)` | 절대 시각 표시 (날짜, 시간, datetime) |
| `formatRelative(utcDate)` | 상대 시각 표시 ("3분 전", "2시간 전") |
| `formatPeriodLabel(periodType, startDate)` | 집계 기간 라벨 ("2026.04.12 (토)") |

### 금지 패턴

```typescript
// BAD — naive UTC 문자열을 로컬 시간으로 잘못 해석함
new Date(utcDate).toLocaleString('ko-KR')
new Date(utcDate).toLocaleDateString('ko-KR')
new Date(utcDate).toLocaleTimeString('ko-KR')

// BAD — naive UTC 문자열과 로컬 Date.now()를 직접 비교하면 9시간 차이 발생
Date.now() - new Date(utcDate).getTime()

// GOOD — utils.ts 함수 사용
formatKST(utcDate, 'datetime')
formatRelative(utcDate)
```

### naive UTC 정규화 패턴

백엔드가 `"2026-04-12T10:12:08"` (Z 없음)을 반환하면 JavaScript `new Date()`는 이를 **로컬 시간**으로 해석한다. UTC로 강제하려면:

```typescript
const normalized = !utcDate.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(utcDate)
  ? utcDate + 'Z'
  : utcDate
```

이 정규화는 `formatKST()`와 `formatRelative()`에 이미 내장되어 있다. 새 날짜 표시 로직을 작성할 때는 반드시 이 함수를 사용할 것.

---

## Design Context

> 자세한 내용은 `.impeccable.md` 참조. 여기서는 핵심만 요약.

### Users
운영팀 엔지니어 (24시간 모니터링). 장애 감지·대응 상황에서도 빠른 상황 판단이 가능해야 한다.
신뢰감과 명확성이 미적 즐거움보다 우선.

### Brand
- **제품명**: Synapse-V (기존 "aoms" 레이블 대체)
- **브랜드 서체**: Lora Italic — 워드마크 전용 (`font-lora italic` Tailwind 클래스)
- **UI 서체**: Pretendard (한글·영문 일반 UI 모두)
- **3단어**: Precise · Trustworthy · Composed

### Aesthetic
- **기준**: 뉴모피즘 유지·개선 (soft 3D shadow), Dark/Light 모드 지원
- **금지**: gradient glow, AI-스러운 보라/파랑 빛 번짐
- **참조**: Linear (정밀함), Bloomberg Terminal (정보 밀도), AWS Console (엔터프라이즈)
- **안티**: ChatGPT/Vercel AI 스타일 (purple haze, gradient shimmer)

### Design Principles
1. 데이터가 주인공 — UI 크롬은 정보 판독을 방해하지 않는다
2. 신뢰는 일관성에서 — 같은 역할, 같은 스타일
3. 긴급도는 색상으로만 — semantic 색상(red/amber/green)은 장식에 사용 금지
4. 여백은 설계된 것 — 밀도 향상을 위해 여백을 줄이지 않는다
5. 브랜드는 절제 속에 — cyan accent(`#00D4FF`)는 핵심 인터랙션에만 집중
6. 정보 밀도를 높여라 — Bloomberg 참조, 한 화면에 더 많은 데이터 표시. 가독성을 해치지 않는 범위에서 여백 최적화

### 개선 범위
- **포함**: `index.css` 토큰, `/components/neumorphic/` 기본 컴포넌트, Sidebar/TopBar
- **제외**: 페이지 레이아웃 구조, 라우팅, API 연동, 비즈니스 로직

---

## Design Decisions (확정된 디자인 결정 — 되돌리지 말 것)

### Dark/Light 모드 시스템

**아키텍처**: 2-tier CSS 변수 구조

1. **스위칭 레이어** (`index.css`, `@theme` 바깥): `:root`(dark 기본) + `:root.light`(라이트 오버라이드)
   - 변수명 접두사: `--t-xxx` (예: `--t-bg-base`, `--t-text-primary`)
2. **토큰 레이어** (`@theme inline` 안): `var(--t-xxx)` 참조 → Tailwind 유틸리티 클래스 생성
   - 변수명 접두사: `--color-xxx`, `--shadow-xxx` (예: `--color-bg-base` → `bg-bg-base`)

**토글 메커니즘**:
- `uiStore.ts`: `theme: 'dark' | 'light'` + `toggleTheme()` (localStorage 영속)
- `ThemeToggle.tsx`: TopBar 사용자명 옆 Sun/Moon 아이콘 버튼
- `index.html`: FOUC 방지 인라인 스크립트 (`localStorage → <html class="light">`)
- DOM 동기화: `document.documentElement.classList.add/remove('light')`

**색상 참조 규칙** (반드시 준수):
```
// GOOD — CSS 변수 기반 Tailwind 토큰 사용
'bg-bg-base'         // 컨텐츠 배경
'text-text-primary'  // 기본 텍스트
'shadow-neu-flat'    // 뉴모피즘 외부 그림자

// BAD — 하드코딩 hex 사용 금지
'bg-[#1E2127]'       // ❌ 테마 전환 시 변경 안 됨
'text-[#E2E8F2]'     // ❌
'shadow-[3px_3px_7px_#111317,...]' // ❌
```

**accent 배경 위 텍스트**: `text-accent-contrast` 사용 (dark: `#1E2127`, light: `#FFFFFF`)
- `text-bg-base` 사용 금지 — light 모드에서 크림색이 시안 위에서 안 보임

**SVG/Recharts 색상** (Tailwind 클래스 사용 불가):
- `MetricChart.tsx`: `useUiStore((s) => s.theme)`로 테마 읽고 색상 상수 분기
- `LINE_COLORS_DARK` / `LINE_COLORS_LIGHT` 두 세트 유지

### 색상 토큰 — CSS 변수 매핑

| 역할 | Tailwind 클래스 | Dark 값 | Light 값 |
|---|---|---|---|
| 컨텐츠 배경 | `bg-bg-base` | `#1E2127` | `#F3F1EC` |
| 카드/헤더/사이드바 | `bg-surface` | `#252932` | `#FFFFFF` |
| 로그인 배경 | `bg-bg-deep` | `#13151A` | `#E8E4DB` |
| 기본 텍스트 | `text-text-primary` | `#E2E8F2` | `#374151` |
| 보조 텍스트 | `text-text-secondary` | `#8B97AD` | `#6B7280` |
| 비활성 텍스트 | `text-text-disabled` | `#5A6478` | `#9CA3AF` |
| 기본 테두리 | `border-border` | `#2B2F37` | `#D1D5DB` |
| 브론즈 구분선 | `border-border-brand` | `#9E7B2F80` | `#D4A84780` |
| 주 accent | `text-accent` / `bg-accent` | `#00D4FF` | `#26C6DA` |
| accent 대비 텍스트 | `text-accent-contrast` | `#1E2127` | `#FFFFFF` |
| 상태: 위험 | `text-critical` | `#EF4444` | `#F43F5E` |
| 상태: 경고 | `text-warning` | `#F59E0B` | `#F97316` |
| 상태: 정상 | `text-normal` | `#22C55E` | `#10B981` |
| 뉴모피즘 외부 | `shadow-neu-flat` | `#111317` / `#2B2F37` | `rgba(0,0,0,0.12)` / `rgba(255,255,255,0.9)` |
| 뉴모피즘 내부 | `shadow-neu-inset` | 상동 (inset) | 상동 (inset) |
| 오버레이 | `bg-overlay` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.3)` |

### 폰트

- **Lora Italic** (`font-family: 'Lora'`): 워드마크 전용. 적용 위치:
  - `LoginPage` — `<h1>Synapse-V</h1>`, copyright `<p>`
  - `Sidebar` — 로고 `<span>Synapse-V</span>`
  - Tailwind 클래스: `font-lora italic`
- **Pretendard**: 나머지 모든 UI (input 포함). Lora를 'Pretendard' font-family 아래 unicode-range로 등록하던 방식은 **삭제됨** — input 영문 타이핑 시 italic 적용되는 문제가 있었음.
- `index.css` `@theme inline`에 `--font-lora: 'Lora', serif` 토큰 정의.

### Border Radius

- **전체 통일**: `rounded-sm` (≈4px) — Bloomberg Terminal 참조, 각지고 전문적인 느낌
- `rounded-full`(배지 pill)만 예외 유지
- `rounded-2xl`, `rounded-xl`, `rounded-lg`, `rounded-md`는 사용하지 않음

### Focus Ring

- 전체 `focus:ring-1` (1px) — `focus:ring-2`는 사용하지 않음
- 색상: `focus:ring-accent` (하드코딩 `focus:ring-[#00D4FF]` 사용 금지)

### 레이아웃 정렬

- TopBar(`py-3`) ↔ Sidebar 로고 영역(`py-3`) 높이 일치 → 구분선이 한 줄로 정렬
- Sidebar 토글 버튼: `w-10 h-10` (TopBar 로그아웃 버튼 `min-h-[40px]`에 맞춤)

### TopBar 구조

- **페이지 타이틀 `<h2>` 없음** — 중복 표시 제거. 각 페이지의 `<PageHeader>` `<h1>`이 유일한 타이틀.
- **ThemeToggle** (`src/components/layout/ThemeToggle.tsx`): 사용자명과 로그아웃 사이 Sun/Moon 토글
- **CommandSearch** (`src/components/layout/CommandSearch.tsx`):
  - 메뉴 텍스트 검색 + 드롭다운 네비게이션
  - 단축키: `⌘K` (Mac) / `Ctrl+K` (Windows)
  - `NAV_ITEMS`는 Sidebar 메뉴와 반드시 동기화할 것
  - 비포커스: 검색 아이콘 `text-text-secondary`, 너비 `w-52`, `⌘K` 힌트 표시
  - 포커스: 검색 아이콘 `text-accent`, 너비 `w-72`, `border-accent` + `ring-accent`

### PeriodToggle (`src/components/reports/PeriodToggle.tsx`)

- 컨테이너: `rounded-sm p-1.5` (뉴모피즘 inset shadow)
- 비활성 버튼: `rounded-[2px]`, hover 시 `ring-1 ring-accent-muted`
- 활성 버튼: `bg-accent text-accent-contrast` + `border-b-2 border-accent`

### Sidebar

- 배경: `bg-surface` (헤더와 동일 — 컨텐츠 영역과 구분)
- 로고: `border-b border-border-brand` (브론즈 라인)
- 활성 메뉴: `bg-accent text-accent-contrast shadow-neu-pressed`

### CriticalBanner

- `position: fixed; top: 0` — 헤더 위를 덮음
- AppLayout에서 `criticalCount > 0` 시 사이드바 `md:mt-9`, 메인 컨텐츠 `mt-9`로 보정 → 헤더 가리지 않음
