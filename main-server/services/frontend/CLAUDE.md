# aoms-frontend — Claude 컨텍스트 가이드

## Project Overview

- **이름**: aoms-frontend
- **목적**: AOMS 백화점 통합 모니터링 시스템 관리 UI
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
├── components/
│   ├── neumorphic/    # 기본 UI 컴포넌트 (NeuCard, NeuButton, NeuInput 등)
│   ├── layout/        # AppLayout, AuthLayout, TopBar, AuthGuard
│   ├── common/        # EmptyState, LoadingSkeleton, ErrorCard, PageHeader
│   ├── dashboard/     # SystemStatusCard, AlertFeed
│   ├── alert/         # AlertTable, AlertDetailPanel, AnomalyTypeBadge
│   ├── charts/        # MetricChart, SeverityBadge
│   ├── reports/       # PeriodToggle, AggregationCard
│   ├── contacts/      # ContactForm, SystemContactPanel
│   ├── collector/     # 수집기 마법사 UI (WizardProgress, WizardStepLayout 등)
│   ├── search/        # SimilarSearchInput, SimilarResultCard
│   ├── trends/        # CriticalTrendBanner, TrendAlertCard
│   ├── system/        # SystemFormDrawer
│   └── user/
├── hooks/
│   ├── queries/       # 조회 훅
│   └── mutations/     # 변경 훅
├── pages/         # 라우트별 페이지 컴포넌트
├── store/         # Zustand 스토어 (authStore, uiStore, wizardStore)
├── types/         # TypeScript 타입 정의
├── lib/           # queryClient, ky-client, utils, metrics-transform
└── constants/     # 앱 상수
```

---

## Commands

```bash
npm run dev      # 개발 서버 (포트 5173)
npm run build    # 타입 체크 + Vite 빌드
npm run lint     # TypeScript 타입 체크
npm test         # Vitest 단위 테스트
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

## Design Context

> 자세한 내용은 `.impeccable.md` 참조. 여기서는 핵심만 요약.

### Users
운영팀 엔지니어 (24시간 모니터링). 장애 감지·대응 상황에서도 빠른 상황 판단이 가능해야 한다.
신뢰감과 명확성이 미적 즐거움보다 우선.

### Brand
- **제품명**: Synapse-V (기존 "AOMS" 레이블 대체)
- **브랜드 서체**: 영어 기하학적 sans-serif (Inter Display, Syne 등) — 워드마크 전용
- **UI 서체**: Pretendard 유지
- **3단어**: Precise · Trustworthy · Composed

### Aesthetic
- **기준**: 뉴모피즘 유지·개선 (soft 3D shadow, #E8EBF0 베이스)
- **금지**: gradient glow, AI-스러운 보라/파랑 빛 번짐
- **참조**: Linear (정밀함), Bloomberg Terminal (정보 밀도), AWS Console (엔터프라이즈)
- **안티**: ChatGPT/Vercel AI 스타일 (purple haze, gradient shimmer)

### Design Principles
1. 데이터가 주인공 — UI 크롬은 정보 판독을 방해하지 않는다
2. 신뢰는 일관성에서 — 같은 역할, 같은 스타일
3. 긴급도는 색상으로만 — semantic 색상(red/amber/green)은 장식에 사용 금지
4. 여백은 설계된 것 — 밀도 향상을 위해 여백을 줄이지 않는다
5. 브랜드는 절제 속에 — indigo accent는 핵심 인터랙션에만 집중

### 개선 범위
- **포함**: `index.css` 토큰, `/components/neumorphic/` 기본 컴포넌트, Sidebar/TopBar
- **제외**: 페이지 레이아웃 구조, 라우팅, API 연동, 비즈니스 로직
