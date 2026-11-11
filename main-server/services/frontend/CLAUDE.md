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
│   ├── agents.ts      # SSH 세션 + 에이전트 CRUD + 제어 + 설치 Job (Phase 6)
│   └── apm.ts         # 트랜잭션 검색·상세·산점도·대시보드 CRUD·스레드 덤프 (Agent-T). 구 `traces.ts`(Tempo)는 제거됨
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
│   │                  #   InstallJobMonitor: Agent-T 설치 Job 이 `needs_target`(JVM 후보 2개 이상)이면 후보 라디오 목록 + "선택한 JVM 으로 설치" → `onSelectTarget(pid)` → `installAgent({agent_id, target_pid})` 재요청
│   ├── chat/          # ChatHeader(범위 칩·세션 드롭다운), ChatPanel, ChatContextNotice, SystemMultiSelect, ChatSessionSearchInput, SessionItemMenu, SessionRenameModal, SessionDeleteConfirmModal
│   ├── help/          # GuestSystemGrid (다중 선택), HelpVisitorForm
│   ├── mascot/        # Synap (마스코트 캐릭터)
│   ├── apm/           # TxFilterBar, TxTable, ApmSummaryCard, detail/, live/(react-grid-layout 대시보드 + widgets/)
│   └── user/
├── hooks/
│   ├── queries/       # 조회 훅 (useDashboardHealth, useSystemDetailHealth, useAgents, useAgentStatus, useAgentConfig, useInstallJob)
│   ├── mutations/     # 변경 훅
│   └── useWebSocket.ts  # WebSocket 실시간 알림 (자동 재연결, heartbeat, React Query 동기화)
├── pages/         # 라우트별 페이지 컴포넌트
│   ├── DashboardPage.tsx              # 통합 대시보드 (하이브리드: 상단 통계 + 하단 시스템 카드)
│   ├── DashboardSystemDetailPage.tsx  # 시스템 상세 (활성 알림 + 로그분석 + 담당자)
│   ├── FeedbackSubmitPage.tsx        # Teams 카드 "해결책 등록" 버튼 진입 단독 페이지 (AppLayout 외부)
│   ├── FeedbackManagePage.tsx        # 해결책 관리 (/feedback/manage, 해결책 검색+감리 두 탭. /feedback/search redirect 포함)
│   ├── AgentListPage.tsx             # 에이전트 목록 (시스템별 그룹, SSH 세션 관리) (Phase 6)
│   ├── AgentDetailPage.tsx           # 에이전트 제어 + 설정 파일 편집기 (Phase 6)
│   ├── apm/
│   │   ├── ApmLivePage.tsx           # /apm/live 실시간 모니터링 (호스트 트리 + 기본 배치 위젯 대시보드, SSE)
│   │   ├── ApmTransactionsPage.tsx   # /apm/transactions 트랜잭션 분석 (Intermax 식 트랜잭션 조회: 검색 패널 + 좌 산점도/통계 탭 + 우 목록)
│   │   └── ApmTxDetailPage.tsx       # /apm/tx/:traceId/:spanId 건별 상세 (좌 세로 메뉴 + 경로 다이어그램)
│   └── ssl/
│       ├── SslDashboardPage.tsx      # 인증서 D-day 현황 대시보드 (60초 폴링)
│       ├── SslServersPage.tsx        # 서버 등록/삭제/SSH 테스트
│       ├── SslDeploymentHistoryPage.tsx  # 배포 이력 + WebSocket 로그 뷰어
│       └── RootCaGuidePage.tsx       # Root CA 설치 가이드 (공개, AuthGuard 없음, OS별 탭)
├── store/         # Zustand 스토어 (authStore, uiStore, wizardStore, sshSessionStore)
│   └── sshSessionStore.ts  # SSH 세션 토큰 인메모리 관리 (Phase 6)
├── types/         # TypeScript 타입 정의
│   └── agent.ts       # AgentInstance, SSHSession, InstallJob 타입 (Phase 6)
├── lib/           # queryClient, ky-client, utils, metrics-transform, sse (consumeSSE/openSse/fetchWithRefresh)
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
npm test              # Vitest 단위 테스트 (전역 격리: `src/test/setup.ts` 가 매 테스트 뒤 storage·타이머 정리, `vite.config.ts` `unstubGlobals`)
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

## 트랜잭션(APM) 메뉴 — Agent-T (ADR-022)

- 사이드바 그룹 "트랜잭션": `/apm/live`(실시간 모니터링), `/apm/transactions`(트랜잭션 분석), `/apm/tx/:traceId/:spanId`(건별 상세, 메뉴 없음). 시스템 상세 페이지의 성능 분석 영역도 `api/apm.ts` 요약으로 교체됨(Tempo 기반 `api/traces.ts`·TraceDotChart 등 제거).
- **SSE** (`src/lib/sse.ts`): `consumeSSE`(스트림 파서), `openSse`(재연결 + 인증), `fetchWithRefresh`(401 시 토큰 갱신 후 1회 재시도). SSE 는 admin-api 가 아니라 gateway(`/t/v1/stream`)로 가며 nginx 프록시 경로를 사용한다. EventSource 는 헤더 인증이 안 되므로 쓰지 않는다.
- **실시간 모니터링 화면 (Intermax 식)**: 저장 단계 없이 항상 기본 배치(`components/apm/live/defaultLayout.ts` `DEFAULT_LAYOUT`, 12종·12열: 1행 액티브 큐(w7) + 트랜잭션 모니터링(w5), 이후 2개씩 w6 쌍 — TPS·응답 / 에러율·진행 중 / CPU·힙 / 사용자·스레드·커넥션 풀 / URL·SQL 상위, 편집에서 추가·삭제 가능, 위젯 추가 기본 크기는 `widgetRegistry` `defaultSize`)가 보인다.
  - 좌측 `HostTree`("호스트 목록", main 높이를 채우는 sticky 풀하이트 컬럼(`--apm-h`), 자체 스크롤, 접기 가능, 1024px 미만은 토글 드로어): 전체(OVERALL) > 시스템 그룹 > 인스턴스 행(시리즈 색 스와치, 수신 상태 점 live<=15초/stale<=120초/off, CPU). 소스는 `useAgents({agent_type:'agent_t'})`(label_info.instance_role, 없으면 host)와 SSE 스트림에서 본 인스턴스의 합집합(`lib/apm/liveScope.ts buildHostTree`). 선택한 범위(`Scope`)를 모든 위젯이 따른다. `?system=` 은 해당 시스템을 미리 선택.
  - 호스트 목록 체크박스(ALL·시스템 그룹 tri-state `aria-checked="mixed"`·인스턴스): 체크 해제한 인스턴스는 모든 위젯·요약 띠·칩에서 제외(행 이름 클릭=범위 선택과 별개). 제외 목록만 사용자별 localStorage(`synapse.apmLive.excludedInstances.{userId}`, `hooks/useExcludedInstances.ts`)에 저장하므로 새 인스턴스는 기본 포함. 칩 바는 같은 제외 집합을 토글한다(단일 소스).
  - 상단: `InstanceChipBar`(ALL + 인스턴스 칩), `SummaryStrip`(132px 띠(2xl 140px), 위젯 카드와 같은 `bg-bg-base shadow-neu-soft rounded-sm` 플랫 카드(inset 음각 금지): 하단 트랙에 완료 트랜잭션 점이 좌→우로 흐름 — canvas+rAF, Intermax 식으로 **화면에는 항상 큰 글로우 공 하나**(반지름 18px, 260px 투명→색 꼬리, `flowParticles.ts BALL_R/TAIL_LEN`)만 3.4초(`TRAVEL_MS`, 완만한 ease-in-out)로 이동, 나머지는 대기열(최대 200, 2건 초과 시 오래된 것 건너뜀). **공 생애(옅은 파스텔 3색)**: 흐르는 큰 공은 항상 옅은 파랑(정상)이다(인스턴스 시리즈 색 아님). 진행 중(`events.active[].top`) 건 중 경고(>=slow_ms)/심각(>=3x)인 건은 처음부터 노랑·빨강으로 나타나지 않고, 트랙 왼쪽(`TRACK_INSET`)에서 **옅은 파랑 공으로 들어와**(`ENTER_SPEED` 0.5px/ms ≈ 0.6~0.7초, 여러 공이 병렬로 앞 공과 최소 간격을 지키며 입장 — 뒤쪽 공은 `ENTER_CATCHUP_MS` 로 따라붙고, 구역 안 공은 도착한 공이 앞으로 밀어 자리를 낸다) 가운데 구역(두 구분선 사이)에 합류한 **뒤에야** 색이 바뀐다: snapshot 경과를 로컬 외삽(`elapsed0 + now - snapAt`)해 slow 이상이면 파랑->노랑, 3x slow 이상이면 노랑->빨강으로 `RECOLOR_MS` 간격 한 단계씩 부드럽게 전환(도착 후 `ARRIVE_HOLD_MS` 250ms 뒤 첫 전환, `RECOLOR_MS` 300ms — 이미 심각인 건도 도착 후 약 0.55초 안에 파랑->노랑->빨강, 한 번 오른 단계는 같은 id 에서 내려가지 않음, 자리표시 공도 같은 입장 후 버킷 단계까지). 구역 안에서는 **천천히 좌우로 오가며**(1차원: 속도 18~40px/s 를 id 해시로 결정, 벽 반사, 이웃과는 같은 질량 탄성충돌=속도 맞교환 + 위치 보정으로 최소 간격 6px 유지, 벽은 구분선에서 공 반지름+8px 안쪽, 프레임 델타 50ms 상한, 최대 8개 + "+N" — 가득 차도 새 심각 건은 가장 뒤 경고 공 자리를 넘겨받아 빨강으로 간다, `stepPaused`/`syncPaused`/`zoneBounds`), 완료·소멸하면 그 시점 x 에서 짧게(450ms, 약 54px, 알파 `(1-t)^2.5`·축소·하강) 빠져나가며 아래층에 그려져 이웃 공을 가리지 않는다. 자리표시<->실제 공 id 교체(top-N 순환)는 완료로 치지 않고 자리·색을 넘겨받으며, 사라진 자리표시는 연출 없이 치운다. 색 토큰은 `--t-apm-ball-{normal,warning,critical}`(dark #9cc3f5/#f5dd8a/#f2a0a0, light #8fb3e0/#e6c766/#e39090)와 라이트 전용 윤곽 `--t-apm-ball-*-ring`(진한 같은 계열, 라이트는 흐르는 큰 공 포함 글로우 대신 1.5px 링), 글로우는 약하게. 띠 경고 숫자·액티브 큐·산점도 경고는 `--t-apm-warning`(dark #f5dd8a / light #ae7f00, `text-apm-warning`), 심각 숫자는 `text-critical-text`(공과 같은 빨강 계열). 구분선은 `--color-border-alt`. 띠 가운데 열은 고정폭(`sm:grid-cols-[1fr_17rem_1fr]`)이라 숫자 자릿수가 바뀌어도 구분선이 흔들리지 않는다. 헤더: Sidebar 로고 영역과 TopBar 는 모두 `h-14` 라 하단 테두리가 한 줄로 이어진다. 로직은 `lib/apm/flowParticles.ts`, 숨김·화면 밖에서는 정지, `prefers-reduced-motion` 이면 canvas 없이 숫자만, 하나의 inset 띠 안에 숫자 행 + 트랙, 셀 테두리 없이 얇은 세로 구분선 2개, 트랙 행·구분선 높이 64px(공 상하 여백 14px 이상, 빠져나가는 공 하강 `EXIT_DRIFT` 0.2), 트랙은 좌우 36px 안쪽(`TRACK_INSET`: 기준선·정지 공·공 모두, 공은 시작점에서 나타나 끝 40px 구간에서 투명, 꼬리는 시작점에서 자라남); 숫자 25px(중앙 22px) + 라벨 13px 이 오른쪽 인라인(baseline 정렬), 좌우 패딩 24px(lg 32px)·상단 18px; 좌 현재 진행 건수/평균 응답, 중 정상/경고/심각(시맨틱 색), 우 응답/초 (TPS, 완료 트랜잭션/초 그대로 — 파생값·요청/초 없음)/에러율). 1440×900 에서 3번째 그리드 행 하단 878px 이내(TopBar py-2·TabBar py-1·페이지 pt-1.5·칩 바 py-0 로 크롬 축소). **주의**: `cn()`(tailwind-merge)은 `text-[Npx]` 뒤의 `leading-*` 만 남기므로 `leading-none` 은 크기 클래스 뒤에 둔다. 시스템 그룹 행은 `CPU n% / HEAP n%`(jvm.cpu_ratio, heap_used/heap_max 평균, 없으면 `-`), 인스턴스 행은 WAS 유형 뱃지. 선택 항목은 `bg-surface shadow-neu-pressed`(채움 accent 금지). 액티브 큐는 이벤트가 없는 범위 내 인스턴스도 0건 막대로 그린다(`queueBuckets.withZeroBars`). `MiniChart` 는 격자·기준선·y 최대 라벨·KST 시작/끝 시각을 가진다.
  - 위젯은 `WidgetTarget.instanceKeys`(범위 ∩ 칩 선택)로 거르고, 다중 인스턴스는 `widgets/seriesLines.ts` 로 인스턴스별 선 + 고정 시리즈 색(`--t-series-1..12`, Dark/Light 정의는 `index.css` — 상태 3색(파랑 254°·노랑 93°·빨강 20°)과 색상각·ΔE 가 겹치지 않는 초록/보라/청록/갈색/회색 계열, 1~5번은 서로 가장 멀게. 채도 C≥0.04 인 색은 상태 3색 색상각에서 25° 이상 떨어져야 하며 `sqlTokensContrast.test.ts` 가 검증한다)을 쓴다(인스턴스 12개 초과 시 합계 1선). 데이터 없으면 "수신 대기".
  - 스트림은 범위를 바꿔도 재연결하지 않도록 항상 전체 시스템을 구독하고 화면에서 거른다.
  - 편집(추가·삭제·드래그·리사이즈)과 "기본 화면으로"(인라인 확인)는 800ms 디바운스로 본인 `apm_dashboards` 레코드('기본 화면')에 자동 저장(첫 변경 create, 이후 update, 성공 토스트 없음 `useApmDashboardMutations({silent:true})`). 저장본이 없으면 `DEFAULT_LAYOUT`. 다중 화면 전환·저장 버튼·위젯별 대상 지정 UI 는 제거됨.
- **트랜잭션 분석 화면 (Intermax 트랜잭션 조회 이식, `pages/apm/ApmTransactionsPage.tsx`)**:
  - 상단 `TxFilterBar`: 라벨 좌측 인라인 조밀 그리드(기간 KST 날짜+시각 ~ 날짜+시각, 시스템, 인스턴스, 수행 시간 min~max(ms), URI, IP, 사용자 ID) + `기본/상세` 토글(상세: 거래 키·Fetch ≥·SQL 시간 ≥·SQL 실행 ≥·Open Conn ≥·TID(span_id)·GUID(trace_id); 이미 값이 있으면 처음부터 펼침) + `전체/에러만` 토글 + 조회. 필드는 모두 URL 쿼리와 동기(`from/to/systems/role|instance/uri/user_ip/user_id/min_elapsed_ms|min_ms/max_elapsed_ms|max_ms/min_sql_ms/error_only/trace_id/span_id/biz_key/min_fetch_cnt/min_sql_cnt/min_conn_open`, 정렬 `order_by/order`, `offset`). 산점도 드래그 진입 URL(`from/to` ISO, `min_ms/max_ms`, `system`, `instance`)도 그대로 해석한다. 조회(Apply)는 현재 정렬 파라미터를 유지한다.
  - 본문 2단(xl 이상 40:60, 좁으면 세로): **좌** `TxScatterChart`(SVG 산점도, 현재 페이지 결과, 정상=`--color-apm-normal` r=2 / 에러=`--color-apm-critical` 위에 그림 / 선택 건=큰 링, 드래그 영역 → 목록 클라이언트 필터 + "선택 영역 N건 ×" 칩) 아래 탭 3종 — `트랜잭션별 통계`(`components/apm/tx/TxStatsTab`, `GET /apm/transactions/stats-by-uri`, 헤더 정렬, 비율 막대(`ratio` 는 서버가 주는 **백분율 0~100**, 그대로 막대 폭·라벨에 사용) AP=series-1/SQL=series-2, **행 클릭 → 목록·시간대 차트를 그 URI 로 좁힘**(+ "URI ×" 칩), 통계 표 자체는 좁히지 않음), `트랜잭션 차트`(`TxHourlyChart`, `/apm/transactions/hourly`, KST 00~23시 막대=건수(좌축)+선=평균 응답·SQL 평균/실행(우축 ms)), `콜 트리`(선택 건의 `useApmTransactionDetail` 로 요약, 미선택 시 "목록에서 트랜잭션을 선택하세요"). 통계/시간대는 해당 탭이 열렸을 때만 조회. **우** 건수 칩(`전체·정상·에러`는 API `counts`) + `TxTable`(종료 시각·시스템·인스턴스·URI·시작·수행 시간·AP(=응답−SQL−외부, 음수 0)·CPU·SQL·SQL 건수·fetch·외부·IP·사용자·호스트; 헤더 클릭 → 서버 `order_by/order`(기본 `elapsed_ms desc`), 단일 클릭=선택, 더블클릭/Enter=상세를 **새 탭**(`navigate(ROUTES.apmTx)` → 탭 key=pathname 이라 건별 새 탭)) + 페이저(처음/이전/`n / N`/다음/마지막, `PAGE_SIZE=100`, `counts.total`).
  - 선택·드래그 영역·URI 좁히기 상태는 URL(`sp.toString()`)이 바뀌면 초기화(`{k: spKey, ...}` 패턴).
  - **미수집이라 생략**: 인터페이스 ID, 거래명, JDBC 패치, 스레드 메모리(SPEC.md D 절).
  - 트랜잭션 분석 UI 규칙: 본문 2단은 xl 이상 9:11, 기간 필드는 xl 에서 3칸(좁으면 줄바꿈), 목록 보조 열(fetch·외부·사용자·호스트)은 기본 숨김이며 `열 선택` 으로 켠다(사용자별 localStorage `synapse.apmTx.hiddenCols.{userId}`, `hooks/useTxColumns.ts`). 에러 배지는 수행 시간 숫자와 별도 슬롯. 우하단 챗봇 버튼과 겹치지 않게 페이저 우측·페이지 하단에 여백.
  - **DB 커넥션 풀 위젯**(`widgets/JvmConnPoolWidget.tsx`): 왼쪽 합계 사용 중/최대 라인 차트(사용 중 = `jvm.conn_peak`(5초 창 최대, 라벨 "사용 중 (5초 최대)") 우선·없으면 구 에이전트용 `conn_active`(`connUsedNum`/`hasConnPeak`), 최대 = `conn_max`, 호버 툴팁 유지) + 오른쪽 풀별 사용률 목록(`jvm.pools[]`, `lib/apm/liveData.ts` `latestPoolRows`: 인스턴스별 최근 3개 agg 중 풀이 있는 최신 값, 사용률 내림차순·동률은 대기 많은 순). 행 = 이름·`active/max`(max 미상이면 `-`)·`peak > active` 이면 `최대 n`(5초 창, `pools[].peak`)·얇은 막대·대기 스레드 수(`대기 n`). 막대·정렬·색은 `poolUsed` = max(active, peak) 기준(쿼리가 ms 만 커넥션을 잡아 현재값은 거의 0). 색은 `poolLevel`: 대기>0 또는 사용률 ≥100% → `--color-apm-critical`, ≥80% → `--color-apm-warning`, 그 외 `--color-apm-normal`(팔레트 B 상태 토큰). 기본 카드는 상위 5개 + "외 n개", 확대 오버레이(`ChartScaleContext` >1)는 12개. 인스턴스 범위(`target`/`pickAgg`)를 따르고 둘 이상이면 "인스턴스 · 풀" 로 표시. 풀 정보가 없으면 "커넥션 풀 정보가 없습니다 (Agent-T 버전 또는 풀 MBean 미노출)". 합계 max 는 풀이 많으면(예: 29풀 659) 부풀려지므로 포화 판단은 풀별 목록으로 한다. 기본 레이아웃 크기는 그대로(w6·h4, 목록은 카드 안 스크롤).
  - **차트 호버 툴팁**(`widgets/ChartHoverLayer.tsx`, `MiniChart` 이 플롯 위에 얹음 — TPS·응답시간·에러율·CPU·힙/GC·사용자/스레드·커넥션 풀 공통, 확대 오버레이에서도 동일): 포인터가 플롯 위를 지나면 가장 가까운 시각으로 스냅(`lib/apm/chartHover.ts` `nearestIndex` 이분 탐색 + 시리즈 합집합 타임스탬프)해 세로선(`--color-text-tertiary` 50% — 다크에서 `border-alt` 는 흐려 확대 뷰에서 안 보임) + 시리즈별 점 + 툴팁(KST `HH:mm:ss`, 시리즈별 색 스와치·라벨·`format` 값, 값 내림차순, 포인터 y 에 가장 가까운 시리즈 강조)을 보인다. 호버 상태는 레이어 안(`useState`)에만 있어 포인터 이동이 `MiniChart` 본체를 다시 그리지 않는다. 툴팁은 `document.body` 포털 + `position: fixed`(`z-[60]`, 확대 오버레이 z-50 위)·`pointer-events-none` 이라 카드 overflow 에 잘리지 않고, 플롯 오른쪽 끝을 넘으면 왼쪽으로 뒤집고, 세로는 플롯 위쪽 가장자리에 맞춰 아래로 늘어나(플롯 위 범례 값을 가리지 않음) 화면 안으로 보정한다(`useLayoutEffect` 로 크기 측정). 트랜지션이 없어 `prefers-reduced-motion` 과 충돌하지 않는다. 포인터 이탈·탭 비활성(`useTabActive` false)에서 숨김. 키보드: 플롯(`tabIndex=0`, 위젯 헤더 이동 핸들과 별개 요소)에 포커스 후 ←/→ 로 시점 이동(처음엔 최근 시각), Esc 로 툴팁 닫기 — `DashboardGrid` 의 방향키 이동/크기는 `widget-drag-handle` 이 target 일 때만 동작하고 차트 레이어는 방향키를 `stopPropagation` 하므로 충돌하지 않는다. 확대 오버레이 안에서 툴팁이 열려 있으면 Esc 는 툴팁만 닫고(`WidgetZoom` 이 `[data-chart-hover="open"]` 안의 Esc 를 넘김), 툴팁이 없을 때의 Esc 가 확대를 닫는다. 터치 포인터는 무시(스크롤 보존). 산점도(`ScatterWidget`)는 별개 컴포넌트라 영향 없음.
  - 실시간 모니터링 라벨 규칙: 범위(`inScope`)에 시스템이 둘 이상이면 인스턴스 라벨을 `시스템·role`(칩·범례·큐·진행 중 목록), 하나면 role 만(`LiveContext.instanceLabel`). 칩 바는 xl 미만에서 한 줄 가로 스크롤(+우측 페이드). 멈춘 공은 서버 버킷(경고·심각 합)이 `top` 목록보다 많으면 `withPlaceholders` 로 id 없는 자리표시 공을 더해 숫자와 맞춘다(공 간격 >= 2r+6, 넘치면 `+N`). 위젯 "더블클릭하여 확대" 안내는 확대 버튼 툴팁으로만 제공. 확대 오버레이(`WidgetZoom`)는 `aria-modal` 대화상자이며 열리면 대화상자에 포커스, Tab/Shift+Tab 은 안에서 순환(포커스 트랩), 닫으면 확대를 연 위젯 헤더로 포커스 복원. 확대 상태: 카드와 오버레이는 위젯 id 로 상태를 공유한다(`widgetState.ts` `useWidgetState`/`WidgetRuntimeContext`, 예: 트랜잭션 모니터링의 시간 범위 `offsetMin`). 공유하지 않으면 카드가 `30분 전` 인데 오버레이는 `실시간` 으로 열려 `0건` 이 보인다. 오버레이는 (1) 산점도 드래그 선택으로 새 탭을 열 때 `closeZoom()` 으로 먼저 닫고 이동, (2) 탭이 비활성(`useTabActive` false)이 되면 스스로 닫는다(포털이 탭 컨테이너 밖 `document.body` 에 그려지므로). "기본 화면으로" 확인은 헤더 줄이 늘지 않도록 버튼 자리에서 `되돌릴까요? [되돌리기][취소]` 로 한 줄 치환.
- **트랜잭션 상세 화면 (Intermax 트랜잭션 상세 이식, `pages/apm/ApmTxDetailPage.tsx` + `components/apm/detail/*`)**: 헤더(큰 URI, 메타 `system·instance · 시작 KST HH:mm:ss.SSS · ms`, 배지 method/status/에러/예외 클래스/IP/ID/거래키, `상세 정보` 팝오버 = AGENT(system/instance/호스트)·DB(SQL 의 distinct `db`)·TID(span_id, trace_id), 우측 `목록`) + 좌측 세로 메뉴 8종(md 이상, 좁으면 상단 가로 스크롤 탭, role=tab), Intermax 순: `트랜잭션 경로`·`SQL 목록`·`예외(에러)(건수)`·`메소드 통계`·`사용자 전문`·`콜 트리`·`액티브 내역(스택 샘플)`·`리소스`.
  - `메소드 통계`(`TxMethodStatsTab`, `lib/apm/methodStats.ts`): `detail.stacks` 만으로 프런트 집계. 메소드=프레임에서 `(` 앞 `class.method`, 샘플 수=inclusive(스택 어디든 등장, 샘플 가중 `c`), self=최상위 프레임(`f[0]`), 비율=inclusive/전체×100, **추정 시간 = 비율 × (elapsed−sql−ext)**("추정" 라벨+툴팁, 샘플링 기반). inclusive 내림차순, 필터 박스, "JDK/프레임워크 제외"(java./javax./jakarta./sun./jdk./org.apache.catalina|coyote|tomcat/jeus.). 샘플 없으면 안내 문구.
  - `사용자 전문`(`TxParamsTab`): API 최상위 `params:{q,p:[이름,값][],t}|null`(`types/apm.ts TxParams`). 쿼리 스트링(mono·복사) + 파라미터 표(값 `****` 는 dim+`마스킹됨` 배지), `t=true` 면 "일부 생략됨". null 이면 수집 설정 안내.
  - 리소스(`TxResourceTab`, `lib/apm/resourceStats.ts`): 시간 구성 얇은 누적 막대(SQL/Fetch/외부/기타 AP — sql_ms 와 fetch_ms 는 Agent-T 에서 따로 누적되어 겹치지 않음, 기타=elapsed−sql−fetch−ext ≥0) + 범례(ms·%), CPU 라인, DB·외부 호출 그룹(0건이면 "없음"), 커넥션 열림→반환 + 상태(정상/미커밋 warning/미반환 critical, 설명 문장). 컨테이너 720px 이상 2열.
  - 액티브 내역(`TxStackTab`, `buildStackGroups`/`classifyStack` in `lib/apm/methodStats.ts`): 상단 설명문(미계측 ms·샘플 수), 그룹별 행 = 헤드라인(첫 앱 프레임)·분류 칩(프레임 패턴 휴리스틱, "추정")·비율 막대·추정 시간(비율×미계측)·실행 중 프레임·프레임 3개 접기·스택 복사, "메소드 통계에서 보기" 링크.
  - 경로: `TxPathDiagram`(HTML+토큰 색, `[IP] ↓ [WAS 카드 Elapse/AP/SQL/Remote/Count + 콜 트리 배지] ↓ 엣지 "SQL합ms / 실행N" ↓ [DB 카드(db 별, 빈 값 "DB")]`; 분산 trace 면 `parent_span` 트리로 WAS 카드가 원격 엣지로 이어지고 다른 span 카드 클릭 = 그 span 상세 새 탭; `DB 구간 숨김` 체크; 콜 트리 배지 → 콜 트리 메뉴) 아래 `TxPathTab` 을 "시간축" 으로 유지(조용한 트레이스 타임라인: 눈금 헤더(시작 KST + `+ms`) + span 당 1행 얇은 막대(6px) + AP/SQL/Remote 구간 분할 + 범례, 현재 건은 굵은 라벨+옅은 배경, 컨테이너 640px 미만이면 막대를 라벨 아래로).
  - SQL 목록(`TxSqlTab`): 평균(ms) 열, DB 이름 태그, `오래 걸린 순/실행 많은 순` 토글, `focusId` 로 해당 SQL 을 펼치고 스크롤.
  - 콜 트리(`TxCallTreeTab`): 워터폴 표 — 호출 | 수행(ms) | 비율 | 타임라인(컨테이너 ≥720px 에서 우측 40%, 좁으면 라벨 아래 얇은 막대). 막대는 6px·최소 2px, 행별 트랙 없음, 공통 눈금(`lib/apm/timeScale.ts`: 0/¼/½/¾/전체)+옅은 세로선. 색: HTTP=`text-tertiary`, SQL=`apm-normal`, EXT=`text-secondary`, 미계측=점선 윤곽, 전체의 30%↑(루트 제외)=`apm-warning` 막대+숫자+옅은 행 틴트. 노드별 접기/펼치기 + 모두 접기/펼치기, "수행 시간 N% 이하 숨기기"(루트 제외), 종류 배지 HTTP/SQL/EXT, SQL 노드 클릭 → SQL 목록 메뉴로 이동(`onJumpSql`). `CallTreeRow.sqlId` 추가.
  - 예외(`TxExceptionTab`): 건수 = 트랜잭션 에러 + 에러 SQL 건수, 예외 클래스·HTTP 상태·에러 SQL. 메시지/스택 원문은 수집하지 않음.
  - 시간 표출 `formatKST(ts, 'HH:mm:ss.SSS')` 추가(ms 포함).
- **ApmLivePage 테스트 구성**: `src/test/pages/apm/ApmLive{Page,Layout,Widgets}.test.tsx` 3개로 분할(무거운 페이지를 워커에 분산), 공용 헬퍼·beforeEach/afterEach 는 `liveTestKit.tsx`(`vi.mock` 은 각 파일 상단에 선언). 800ms 디바운스 자동 저장 테스트는 `vi.useFakeTimers({shouldAdvanceTime:true})` + `advanceTimersByTimeAsync` 로 검증하고 실시간 대기·긴 `waitFor` 타임아웃을 쓰지 않는다. 시계 의존 테스트(SummaryStrip)는 `performance.now` 를 고정한다.
- **대시보드 레이아웃**: `react-grid-layout`(2.3.0). 레이아웃은 `apm_dashboards`(PG)에 저장.
- **수치 폰트**: 밴드 숫자·범례 값·축 라벨은 `font-num`(`--font-num` = 번들 Pretendard + `tabular-nums` — 폐쇄망 Windows(Consolas 사선 0)에서도 동일하게 보이도록 고정폭 글꼴을 쓰지 않음; 카드·칩 그림자는 `shadow-neu-soft`, 웹폰트 다운로드 없음), 색 견본은 9px `rounded-xs` 사각. 위젯 `scatter` 의 표시 이름은 "트랜잭션 모니터링"(type 키 유지).
- **Canvas 위젯 규칙**: 큐(액티브 대기열)·산점도처럼 점이 많이 찍히는 위젯은 SVG/DOM 이 아니라 **Canvas** 로 그린다(수천 점 + 1초 갱신). 색은 하드코딩하지 않고 CSS 변수를 `getComputedStyle` 로 읽어 쓰며 Dark/Light 전환 시 다시 그린다. 시각은 `formatKST()` 로만 표출.

---

## 챗봇(시냅이) 규칙 — 우하단 `ChatPanel` + 전체 화면 `/chat` 공통

- **사용자별 상태**: `store/chatStore.ts` persist 키는 `chat-ui-state.{userId}`(`chatStorageKey`, 로그인 사용자 없으면 저장 안 함). 저장 항목은 `currentSessionId`·`scopeSystemIds`·`unread`·`lastSentContext`뿐이며 **`isOpen` 은 저장하지 않는다**(새로고침 시 자동으로 열리지 않음). 로그인 사용자가 바뀌면(`authStore` subscribe) 그 사용자 키로 rehydrate — 저장값이 없으면 기본값으로 덮어 이전 사용자 상태를 물려받지 않는다. 로그아웃은 패널 닫기 + 세션·범위 초기화(저장된 사용자 키는 유지).
- **하루 단위 새 대화**: 세션 자동 선택·생성은 `hooks/useChatSessionBootstrap.ts` 한 곳(패널·`/chat` 공용, 다른 곳에 auto-create effect 금지). 패널이 열릴 때(닫힘→열림)와 `/chat` 진입 시마다 현재 세션의 `created_at`(naive UTC)을 `isSameKstDay`(`lib/utils.ts`, `formatKST` 기반 — 수동 +9h 금지)로 비교해 오늘(KST) 시작이 아니면 → 오늘 시작한 가장 최근 세션(빈 세션 포함)을 재사용, 없으면 `POST /chat/sessions {system_ids}` 한 번으로 생성(생성 후 PATCH 없음). 동시 생성은 ref 플래그로 차단. 세션이 정해지기 전(`ready=false`)에는 전송·자동 분석을 막는다.
- **범위(scope)**: 기본 = 로그인 사용자의 담당(primary) 시스템(`hooks/useChatScope.ts`; 사용자가 직접 고른 값이 있으면 그것, 담당이 없으면 admin 이라도 빈 배열=전체). 헤더는 "지식 검색 대상 + 멀티셀렉트" 대신 한 줄 칩(`담당 시스템: 결제·CRM ▾` / `선택 시스템: …` / `전체 시스템 ▾`)이고 클릭하면 `SystemMultiSelect` 를 펼친다. 변경 = 현재 세션 PATCH + 사용자 기본값 저장(담당과 같아지면 "고른 값 없음"으로 복귀). 칩은 서버가 실제로 쓰는 `session.system_ids` 를 우선 보여준다. 우선순위(백엔드 최종 판정): 질문의 시스템명 > 화면 컨텍스트 system_id > 세션 system_ids > 전체.
- **범위 표시**: SSE `scope` 이벤트(`source`=screen/session/all)를 스트리밍 답변 위에 작게 `현재 화면(결제) 기준` / `기본 범위: 결제`(기본값일 뿐 — 질문 시스템이 우선) / `전체 시스템 기준`(`lib/chatScope.ts describeScope`). 지난 답변은 같은 턴 tool 메시지의 `system_id` 를 이름으로 바꿔 `조회: 결제, CRM`(`buildQueriedSystemNames`), 없으면 표시 안 함.
- **화면 컨텍스트**: 패널 열 때 1회 소비(구 `pendingScreenContext`)를 폐기하고 **전송하는 순간**(`useChatStreaming` `handleSend`/`handleAutoInsight`)의 `useScreenContext()` 값을 보낸다. 컨텍스트에 `system_name`(systems 목록에서 id→system_name)·APM 화면(`apm_live`/`apm_transactions`/`apm_tx_detail` + `trace_id`/`span_id`, `resolveScreen`)이 포함된다. `useRegisterScreenContext` 는 멀티 탭 keep-alive 에서 **활성 탭만** 등록한다(숨은 탭이 컨텍스트를 덮어쓰지 않게). `ApmTxDetailPage` 는 `summary.system_id` 를 등록한다.
- **다른 화면에서 열기**: 같은 날이라도 패널을 열 때 화면의 system_id/incident_id 가 이 대화에서 마지막으로 쓴 값(`lastSentContext`)과 다르고 메시지가 있으면 메시지 목록 위에 인라인 한 줄 `다른 화면에서 열었어요. 새 대화로 시작할까요? [새 대화] [계속]`(`ChatContextNotice`, 모달·자동 전환 금지). 지금 화면에 시스템·인시던트가 없으면 안내하지 않는다. 안내는 스크롤 영역 상단에 `sticky` 로 고정(목록이 맨 아래로 스크롤돼 있어도 보이게). 인시던트 상세는 `incident_id` 와 함께 인시던트의 `system_id` 도 `useRegisterScreenContext` 로 등록한다.
- **세션 드롭다운**: 세션 1개여도 항상 표시, 최근 10개 + `formatRelative` 날짜, 맨 아래 "전체 대화 보기" → `/chat`. 시작 화면 예시에 담당 시스템이 1개면 `{이름} 시스템 오늘 이상 있어?` 1개 추가(`useChatPromptCategories`).

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

## 피드백 재등록 횟수(revision_count) 배지 색상 규칙 (P2-E)

`FeedbackDetailView.tsx`의 "재등록 N회" 텍스트는 횟수에 따라 색상을 달리한다:

| revision_count | 클래스 | 의미 |
|---|---|---|
| 1 ~ 2 | `text-text-disabled` | 이력 참고용 — 중요도 낮음 |
| 3 ~ 4 | `text-warning font-medium` | 소프트 리밋 도달 경고 |
| 5+ | `text-text-disabled` + "(한도 초과)" 접미 | 하드 리밋 초과 — 이미 차단됨 |

**임계값 상수**: `routes/incidents.py`의 `_RESUBMIT_SOFT_LIMIT = 3`, `_RESUBMIT_HARD_LIMIT = 5`

**FeedbackForm.tsx (resubmit 모드) 에러 처리**:
- `onSuccess` — `data.warning` 존재 시 노란색 경고 카드 표시 (`AlertTriangle` 아이콘, `border-warning/30 bg-warning/5`)
- `onError` — 409 Conflict 시 `HTTPError` + `err.response.json()` 으로 `ResubmitLimitError` 파싱 → 그레이 블록 모달 (`Ban` 아이콘)

**FeedbackRevisePage.tsx**: 동일한 409 처리 — 블록 모달 표시. (Teams 반려 카드 링크로 진입하는 독립 페이지)

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

- TopBar(`h-14`) ↔ Sidebar 로고 영역(`h-14`) 높이 일치 → 구분선이 한 줄로 정렬
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

### 멀티 탭 워크스페이스 (MDI, `src/components/layout/tabs/`)

- **구조**: `App.tsx` 의 앱 레이아웃 라우트는 `path="/*"` 하나이며 내부 라우트 트리는 `AppRoutes({location})`(`<Routes location>`)로 분리. `AppLayout` 은 `<Outlet/>` 대신 `<TabWorkspace renderRoutes>` 를 렌더링한다. 새 라우트는 `AppRoutes` 에 추가하고, 탭 제목은 `tabs/tabMeta.ts` (`STATIC_TITLES`/`DETAIL_TITLES`)에 등록한다 — **등록되지 않은 경로는 탭이 만들어지지 않는다**(redirect 전용 경로 보호). 사이드바 라벨과 동기화할 것.
- **TopBar 아래 `TabBar`**: role=tablist/tab, 활성 탭 `bg-bg-base shadow-neu-pressed`, × 는 활성 탭 상시·그 외 hover/focus 시 표시, 가운데 클릭/Delete 키로 닫기, ←/→/Home/End 포커스 이동, 우측 ⋯ 메뉴(다른 탭 닫기/모두 닫기). `/dashboard` 는 핀 고정(닫기 불가).
- **keep-alive**: 열린 탭마다 `<main role=tabpanel hidden={!active}>` 안에서 자신의 location 으로 라우트를 마운트 유지(scrollTop 은 패널이 직접 보존/복원). 보이는 `main` 은 항상 1개이므로 `closest(main)` 은 그대로 동작, 전역 조회는 `main:not([hidden])` 사용. 세션 복원 탭은 처음 활성화될 때 마운트(지연 마운트).
- **탭 식별 = pathname** (끝 슬래시 제거). 예외: `/apm/transactions` 에 ISO `from`/`to` 가 있으면(산점도 영역 드래그 → `?from&to&min_ms&max_ms&system=..&instance=..`) key=`pathname?from=..&to=..` 로 범위마다 별도 탭, 제목 `트랜잭션 조회 [HH:mm~HH:mm]`(KST). `tabMeta.tabKeyFor/resolveTabTitle(pathname, search)`; `tab.location.pathname` 은 항상 실제 라우트 경로. 같은 pathname 으로 이동하면 새 탭 없이 활성화되고 탭의 location(search 포함)이 최신값으로 갱신된다. `replace` 로 다른 경로로 떠난 직전 탭(권한 없음 redirect 등)은 자동 제거.
- **상한 12개** (`MAX_TABS`): 초과 시 핀 제외 LRU 탭을 닫고 토스트 안내. 탭 목록(경로·제목·search)은 `sessionStorage[synapse.tabs.v1]` 에 저장(페이지 상태는 저장 안 함).
- **훅**: `useTabActive()` — 비활성(숨김) 탭이면 false. 폴링은 `refetchInterval: active ? N : false`, SSE/애니메이션/타이머는 `useEffect` 에서 `active` 가 false 면 중단. 적용 완료: useDashboardHealth/useAlerts/useIncidents/useTrendAlerts/useRealErrorSeries. ApmLivePage 도 적용(`useApmLiveStream(ids, active)` 로 SSE/폴링 중단·재활성화 시 snapshot 재동기화, 시계 tick·SummaryStrip `paused`·ScatterWidget 1초 tick 중단). `useTabTitle(title)` — 상세 페이지가 탭 제목을 호스트/URI 등으로 갱신(적용: AgentDetailPage, ApmTxDetailPage).
- **주의**: 숨겨진 탭의 페이지가 effect 에서 `navigate()/setSearchParams()` 를 호출하면 활성 URL 이 바뀐다 — 탭이 숨겨진 동안 URL 을 건드리는 effect 는 `useTabActive()` 로 가드할 것.

### PeriodToggle (`src/components/reports/PeriodToggle.tsx`)

- AlertHistoryPage / KnowledgePage / IncidentListPage와 동일한 슬라이딩 filled 인디케이터 패턴 사용
- 컨테이너: `bg-bg-base shadow-neu-pressed relative rounded-sm p-1`
- 슬라이딩 인디케이터: `bg-accent shadow-neu-flat absolute rounded-sm` (JS `offsetLeft/offsetWidth` 기반 위치)
- 활성 버튼: `text-accent-contrast font-semibold`
- 비활성 버튼: `text-text-secondary hover:text-text-primary`

### Sidebar

- 배경: `bg-surface` (헤더와 동일 — 컨텐츠 영역과 구분)
- 로고: `border-b border-border-brand` (브론즈 라인)
- 활성 메뉴: `bg-accent text-accent-contrast shadow-neu-pressed`

### CriticalBanner

- `position: fixed; top: 0` — 헤더 위를 덮음
- AppLayout에서 `criticalCount > 0` 시 사이드바 `md:mt-12`, 메인 컨텐츠 `mt-12`로 보정 → 헤더 가리지 않음

### 사이드 드로어 표준 패턴 (절대 변형 금지)

**왜 이 항목이 있는가**: 우측 슬라이드 드로어/패널이 10개 이상 존재. 신규 추가 시 매번 다음 4가지 실수가 반복됨 — 한 번 명문화. **반드시** 아래 패턴 그대로 복사 사용.

#### 핵심 4요소 (모두 필수)

```tsx
import { useBannerVisible } from '@/hooks/useBannerVisible'
import { cn } from '@/lib/utils'

export function MyDrawer({ open, onClose, ... }) {
  const bannerVisible = useBannerVisible()  // ← (1) 훅 호출

  return (
    <>
      {/* Overlay — 배너 위치 영향 없음 */}
      <div
        className={cn(
          'bg-overlay fixed inset-0 z-40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer — 4요소 모두 적용 */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          // (2) shadow 없음 — border-l만 사용. 임의 그림자(`shadow-neu-flat`, `shadow-[-8px_0_32px_rgba(...)]` 등) 절대 금지
          // (3) `transition-[translate,top]` — Tailwind v4의 translate-x-*는 CSS `translate` property를 사용하므로
          //     `transition-[transform,top]`은 동작 안 함 (transform 변경 없음). 반드시 `translate`로.
          'border-border bg-bg-base fixed right-0 bottom-0 z-50 flex w-full max-w-[480px] flex-col border-l transition-[translate,top] duration-200',
          // (4) bannerVisible로 top 동적 — `fixed top-0` 고정 절대 금지 (배너에 X버튼 가려짐)
          bannerVisible ? 'top-12' : 'top-0',
          // 슬라이드 애니메이션
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* 콘텐츠 */}
      </div>
    </>
  )
}
```

#### 반복 실수 체크리스트 (PR 머지 전 검증)

| # | 잘못된 패턴 | 올바른 패턴 | 결과 |
|---|------------|-------------|------|
| 1 | `fixed top-0 right-0 bottom-0` | `fixed right-0 bottom-0` + `bannerVisible ? 'top-12' : 'top-0'` | CriticalBanner와 X버튼 충돌 |
| 2 | `shadow-[-8px_0_32px_rgba(0,0,0,0.4)]` 또는 `shadow-neu-flat` | **shadow 없음** (border-l만 사용) | 임의 그림자 또는 shadow-neu-flat = 디자인 시스템 위반. 드로어 외곽 shadow 자체를 추가하지 말 것 |
| 3 | `transition-transform` 또는 `transition-[transform,top]` | `transition-[translate,top]` | **Tailwind v4의 translate-x-*는 CSS `translate` property 사용** (transform 아님). transform을 transition에 넣으면 슬라이드가 즉시 발동되어 보이지 않음 — 반드시 `translate` 명시 |
| 4 | `useBannerVisible` 훅 미사용 | `const bannerVisible = useBannerVisible()` | top 위치 고정 → 배너 활성 시 가려짐 |
| 5 | z-index 임의 변경 (`z-[60]`, `z-[70]` 등) | overlay `z-40`, drawer `z-50` 표준 | CriticalBanner도 `z-50`이지만 위치(top)가 달라 자연스럽게 분리됨 |

#### 표준 패턴이 적용된 참조 파일 (복사용)

- `components/incident/IncidentSidePanel.tsx` ← **이 파일을 베이스로 복사할 것**
- `components/alert/AlertDetailPanel.tsx`
- `components/admin/KnowledgeGuides/GuideEditModal.tsx`
- `components/contacts/ContactFormDrawer.tsx`
- `components/system/SystemFormDrawer.tsx`
- `components/user/UserFormDrawer.tsx`
- `components/trace/TraceDetailPanel.tsx`
- `components/knowledge/FeedbackTab.tsx` (FeedbackDetailDrawer)
- `pages/FeedbackManagePage.tsx` (FeedbackDetailDrawer)
- `pages/admin/ChatToolsPage.tsx` (ToolDetailPanel)
- `pages/admin/LlmAgentConfigPage.tsx` (ConfigDrawer)

#### 예외 — 풀스크린 모달 sheet 패턴

`SystemContactPanel`, `SystemHostPanel`은 `fixed inset-0 z-[60]` 컨테이너 내에 sheet를 우측 정렬하는 패턴 — 위 표준과 다름. 이 패턴이 더 적합한 케이스(컨테이너 자체가 모든 위에 떠야 할 때)에만 사용. 신규 사이드 드로어는 위 표준 패턴 우선.

- **건별 상세 SQL 탭** (`components/apm/detail/TxSqlTab.tsx` + `SqlViewer.tsx`): SQL 한 줄 요약 행(구문 종류 + MyBatis 매퍼 ID 또는 앞 80자, 지표 열, 시간 비례 바, 헤더 클릭 정렬, 기본 시간 내림차순) → 행 클릭 시 인라인 뷰어(정렬/원문 토글, 복사, 줄번호, 구문 강조). 포매팅·토크나이저는 `lib/apm/sqlFormat.ts`(`sql-formatter` plsql 방언, 실패 시 원문 폴백). 구문 강조 토큰 `--t-sql-{bg,keyword,function,string,bind,comment}`는 `index.css` dark/light 양쪽에 정의(기존 시맨틱 토큰 alias), Tailwind 클래스 `text-sql-*`/`bg-sql-bg`.

- **APM 대시보드 레이아웃 버전**: 저장 레이아웃의 `filters.layout_version` 이 `defaultLayout.ts` 의 `LAYOUT_VERSION`(현재 4) 보다 낮거나 없으면 로드 시 `DEFAULT_LAYOUT` 으로 한 번 교체·자동 저장한다. 기본 배치를 바꿀 때 이 값을 올린다.

- **Agent-T 사전 점검**: `AgentDetailPage` 설치 카드의 `사전 점검` 버튼(agent_t 만, `설치 실행` 옆) → `agentsApi.precheckAgent(id, token)` (`POST /agents/{id}/precheck`, 서버 무변경 dry-run). 결과는 카드 안 `PrecheckChecklist` 에 인라인(항목·상태 아이콘·상세 + 점검 시각 KST, 상태색 `text-normal/warning/critical`). SSH 세션 없음·호스트 불일치·설치 경로 충돌이면 비활성(설치 실행과 동일 규칙) + 안내.
- **Agent-T 설치 폼 — 요청 파라미터 수집(사용자 전문)**: `AgentTForm` 체크박스 → label*info `capture_params: true|false`(항상 포함), 체크 시에만 선택 입력 `capture_params_include`/`capture_params_exclude`(쉼표 구분 glob, 공백 제거 정규화 `normalizeGlobs`, 항목별 허용 문자 `[A-Za-z0-9/*\-.\*?]`검증`validGlobs`—`useAgentFormLogic.ts`). 적용은 재설치 필요. `AgentDetailPage` 정보 영역에 수집 여부·포함/제외 URI 표시.
  - **동시 사용자·JVM 스레드 위젯**(`widgets/JvmUsersThreadsWidget.tsx`, 레지스트리 id `jvm_users_threads` 유지·제목만 "동시 사용자·JVM 스레드"): 두 선 — "동시 사용자 (5분 고유)"(agg `users_5m`, gateway 가 `user_id`, 없으면 `user_ip` 로 5분 슬라이딩 고유 개수를 계산, `--color-accent`) + "JVM 스레드"(`jvm.threads` = ThreadMXBean 전체 스레드, WAS 워커 아님, `--color-text-secondary`). 범례 오른쪽 ⓘ 힌트(title/aria-label)가 두 값을 한 문장씩 설명. 인스턴스가 여럿이면 두 선 모두 합계(" 합계" 접미). 구 gateway(`users_5m` 없음)면 사용자 선 생략. 이전의 "진행 중 건수 = 동시 사용자" 는 요청이 ms 에 끝나 항상 0 이라 폐기.