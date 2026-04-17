# AOMS Frontend — impeccable 스킬로 시각화·화면 조정 계획

## Context

사용자 요청: **impeccable 플러그인을 활용해 Synapse-V 프론트엔드의 시각화와 화면 조정을 단계적으로 개선**한다.

현재 상태(이미 확인됨):
- `main-server/services/frontend/.impeccable.md` 디자인 컨텍스트 **이미 작성 완료** — Synapse-V 브랜드, cyan accent(#00D4FF), Bloomberg Terminal 지향 밀도, Precise·Trustworthy·Composed 원칙, 뉴모피즘 유지
- `main-server/services/frontend/CLAUDE.md` "Design Decisions" 섹션에 Dark/Light 2-tier CSS 변수 시스템, Lora Italic 워드마크, `rounded-sm` 통일, `focus:ring-1` 등 **확정 결정 명시** — 되돌리면 안 됨
- 스택: React 18 + Vite 6 + TailwindCSS 4.1 + Recharts 2.15 + Zustand + React Query
- 17개 라우트 페이지, 54개 컴포넌트, 60+ CSS 토큰 성숙

따라서 **Step 0 (teach-impeccable)은 건너뛴다**. 기존 컨텍스트를 덮어쓰지 말 것.

개선 목표:
1. 대시보드·리스트·차트 **시각화 품질** 향상 (정보 밀도 + 위계)
2. 전역 **화면 조정** — 간격 리듬, 타이포 위계, 반응형 밀도
3. 이미 확정된 디자인 결정(Dark/Light, Lora, rounded-sm 등)은 **보존**

---

## 권장 워크플로우 (3단계)

### Phase A — 진단 (병렬 가능, 각 10~15분)

```
/impeccable:audit       src/pages/DashboardPage.tsx src/components/dashboard/
/impeccable:critique    src/pages/DashboardPage.tsx
```

| 명령 | 목적 | 산출물 |
|---|---|---|
| `/impeccable:audit` | 접근성·성능·일관성 P0~P3 이슈 목록화 | 기술적 문제 우선순위표 |
| `/impeccable:critique` | Nielsen 10 휴리스틱 + 페르소나(운영팀) UX 평가 | UX 관점 우선순위표 |

**집중 대상**: `DashboardPage`, `SystemHealthGrid`, `EnhancedSystemCard`, `AlertFeed`, `MetricChart`.

### Phase B — 시각화·화면 조정 (우선순위 순차 실행)

진단 결과에 따라 선택적으로 실행하되, 기본 권장 순서는 다음과 같다.

| 순서 | 명령 | 기대 효과 | 주의사항 |
|---|---|---|---|
| 1 | `/impeccable:typeset` | 숫자·지표에 `tabular-nums`, 제목·본문·메타 위계 강화, Pretendard 유지 | **Lora는 워드마크 전용 유지**, Pretendard 교체 금지 |
| 2 | `/impeccable:arrange` | 4/8pt 그리드 통일, Sidebar↔Content↔Panel 비율, 카드 내부 패딩 일관성, Bloomberg-스타일 밀도 향상 | `rounded-sm` 확정값 유지, 여백은 설계된 것 — 무작정 줄이지 말 것 |
| 3 | `/impeccable:colorize` | cyan accent의 전략적 집중 배치, severity 3색(red/amber/green) 장식 목적 사용 금지 확인 | **Dark/Light 2-tier 변수 시스템 유지** (`--t-xxx` + `--color-xxx`), 하드코딩 hex 금지 |
| 4 | `/impeccable:animate` | 로딩·상태 전환·WebSocket 알림 수신 시 의도 있는 모션 | playful 금지, 장애 상황의 차분함 유지, `prefers-reduced-motion` 대응 |
| 5 | `/impeccable:polish` | 픽셀 정렬, 사소한 일관성 오류 정리 | CSS 변수 기반 유지 |

### Phase C — 선택적 심화

필요 시에만 호출.

- `/impeccable:normalize` — 토큰에서 이탈한 하드코딩 값 일괄 정렬 (`focus:ring-2`, `rounded-xl` 등 금지 패턴 제거에 유효)
- `/impeccable:adapt` — 반응형 밀도 조정 (lg/md/sm 브레이크포인트별)
- `/impeccable:delight` — 빈 상태(EmptyState) 마이크로 인터랙션 — **운영팀 UI이므로 최소한만**

`/impeccable:distill`, `/impeccable:frontend-design`은 처음부터 재설계를 의미 — 이미 확정된 결정을 뒤집을 위험이 있어 **권장하지 않음**.

---

## 우선 타깃 파일

| 파일 | 왜 먼저 | 관련 명령 |
|---|---|---|
| `src/index.css` | 토큰·폰트·shadow의 단일 진실 원천 | typeset, colorize, normalize |
| `src/pages/DashboardPage.tsx` | 메인 랜딩 — 개선 효과 체감 최대 | audit, critique, arrange |
| `src/components/dashboard/SystemHealthGrid.tsx` | 시스템 카드 그리드 — 밀도 개선 핵심 | arrange |
| `src/components/dashboard/EnhancedSystemCard.tsx` | 가장 반복되는 시각화 단위 | typeset, colorize |
| `src/components/charts/MetricChart.tsx` | Recharts — SVG 색상은 JS 분기 (`LINE_COLORS_DARK/LIGHT`) 유지 필수 | colorize (주의: Tailwind 클래스 불가) |
| `src/components/common/PageHeader.tsx` | 17개 페이지 공통 헤더 — 타이포 효과 전파 | typeset |
| `src/components/alert/AlertTable.tsx` | 정보 밀도 핵심, tabular-nums 효과 큼 | typeset, arrange |

**수정 금지 영역**: 라우팅(`App.tsx`, `constants/routes.ts`), API 레이어(`src/api/`), 비즈니스 훅(`src/hooks/`), `uiStore.theme` 로직.

---

## 반드시 보존할 기존 결정 (deal-breakers)

impeccable 스킬 실행 결과가 이를 건드리면 **거부하거나 범위를 좁혀서 재시도**한다.

1. Dark/Light 2-tier 변수 시스템 (`:root` + `:root.light`, `--t-xxx` → `--color-xxx`)
2. Lora Italic은 **워드마크(Synapse-V 글자)에만** — input·일반 텍스트에 확산 금지
3. `rounded-sm`(4px) 전역 통일, `rounded-full`(pill) 예외 — `rounded-xl/2xl` 재도입 금지
4. `focus:ring-1` + `ring-accent` — `ring-2`·하드코딩 색상 금지
5. 색상 참조는 Tailwind 토큰(`bg-bg-base` 등)만. `bg-[#1E2127]` 등 하드코딩 hex 금지
6. Recharts는 JS에서 `useUiStore.theme`으로 색상 분기 (`MetricChart.tsx` 패턴)
7. TopBar에는 페이지 타이틀 `<h2>` 두지 않음 (중복 제거 결정)
8. 타임존: 모든 날짜 표시는 `formatKST` / `formatRelative` 사용 (`new Date().toLocaleString` 금지)

---

## 검증 절차

각 impeccable 명령 실행 후:

```bash
cd main-server/services/frontend
npm run lint:fix                       # ESLint 자동 수정
npm run format                         # Prettier
npm run lint                           # 에러 0 확인
npm run build                          # 타입 체크 + Vite 빌드 성공 확인
npm run dev                            # 포트 5173에서 수동 검증
```

수동 검증 체크리스트:
- [ ] Dark/Light 토글 양쪽에서 색상 깨짐 없음 (TopBar Sun/Moon 아이콘)
- [ ] `⌘K` CommandSearch 동작
- [ ] DashboardPage 시스템 카드 그리드, SystemHealthGrid 레이아웃 정상
- [ ] MetricChart 차트 Dark/Light 색상 분기 정상
- [ ] AlertTable 숫자 정렬(tabular-nums) 확인
- [ ] `prefers-reduced-motion: reduce` 브라우저 설정 시 애니메이션 억제

백엔드 연동이 필요한 페이지(대시보드 실데이터) 테스트 시:
```bash
make dev-up && make run-api && make run-analyzer
```

---

## 실행 예시

사용자가 이 계획 승인 후 실행할 흐름:

```
1. /impeccable:audit src/pages/DashboardPage.tsx
   → P0~P3 이슈 리스트 받음
2. /impeccable:critique src/pages/DashboardPage.tsx
   → UX 이슈 받음
3. /impeccable:typeset   (전역)
   → index.css 토큰 + 컴포넌트 타이포 업데이트 PR
4. /impeccable:arrange src/pages/DashboardPage.tsx src/components/dashboard/
   → 밀도·간격 조정
5. (이하 선택적 진행)
```

각 단계는 독립 커밋으로 나누는 것을 권장. 한 번에 모든 스킬을 실행하면 리뷰·롤백이 어렵다.
