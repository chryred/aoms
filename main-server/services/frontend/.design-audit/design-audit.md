# Design Audit — PostmortemTable (FeedbackManagePage)

**Change**: `PostmortemCard` → `PostmortemTable` in `FeedbackManagePage.tsx` 해결책 검색 탭  
**Date**: 2026-05-08  
**Verdict**: PASS

---

## 5개 검증 항목 결과

### 1. 하드코딩 색상·그림자 금지 (CSS 변수만 허용)
**PASS**

- `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>` 전체에 하드코딩 hex 없음
- `document.querySelector('[class*="[#"]')` 결과: 0건
- `element.querySelectorAll('[style]')` 결과: 0건
- 모든 색상은 CSS 변수 기반 Tailwind 토큰 사용:
  - `border-border`, `bg-surface`, `text-text-disabled`, `text-text-primary`
  - `hover:bg-surface`, `text-accent`, `text-text-disabled`

---

### 2. border-radius 규칙 (`rounded-sm` 전용, `rounded-full`은 pill만)
**PASS**

- 테이블 wrapper: `overflow-x-auto rounded-sm border` → `rounded-sm` 사용
- 심각도 배지: `rounded-full` — pill 배지에 한정된 허용 예외
- `rounded-xl`, `rounded-lg`, `rounded-md`, `rounded-2xl` 사용 없음

---

### 3. Dark / Light 모드 색상 안정성
**PASS**

- Dark → Light 모드 전환 시 모든 색상 정상 전환 확인 (스크린샷 05-light-mode.png)
- 배경: `bg-bg-base`(크림 `#F3F1EC`) + 테이블 `bg-surface`(흰색) 정상
- 배지, 테두리, 텍스트 모두 CSS 변수로 연결되어 즉시 전환됨
- 색상 깨짐 없음

---

### 4. 뉴모피즘 shadow 토큰 일관성
**PASS**

- 탭 트랙 컨테이너: `shadow-neu-pressed` (올바른 inset 표현)
- 탭 활성 슬라이딩 인디케이터: `shadow-neu-flat bg-accent`
- 테이블 자체에는 shadow 없음 — `border-border border` 만 사용 (드로어 표준 패턴과 동일한 border-only 원칙)
- 임의 shadow (`shadow-[...]`, `shadow-neu-inset` 오용 등) 없음

---

### 5. accent 색상 남용 금지 (핵심 인터랙션에만)
**PASS**

- `text-accent` 사용 위치:
  1. 활성 탭 슬라이딩 인디케이터 (`bg-accent`)
  2. 활성 정렬 컬럼 sort 아이콘 (`text-accent h-3 w-3`)
- 비활성 sort 아이콘: `text-text-disabled` (올바름)
- 심각도 배지 INFO: `bg-accent/10 text-accent border-accent/30` — 시맨틱 상태 표현, 장식 아님
- 검색 버튼: `bg-accent` (기본 CTA — 핵심 인터랙션)
- accent 남용 없음

---

## 기능 동작 확인

| 항목 | 결과 |
|------|------|
| 빈 상태 (검색 전) | 정상 — 안내 메시지 표시 |
| 목록 모드 (키워드 없이 검색) | 정상 — 11건 표시, 유사도 컬럼 없음 |
| 검색 모드 (키워드 "메모리") | 정상 — 8건, 유사도 컬럼 표시 (1.0000~0.1111) |
| # 정렬 클릭 | 정상 — desc 정렬, 아이콘 `chevron-down text-accent` |
| 유사도 정렬 (기본) | 정상 — 검색 시 자동 desc 정렬 적용 |
| Light 모드 | 정상 — 모든 색상 전환됨 |
| 콘솔 에러/경고 | 0건 |

---

## 반응형 확인

| 뷰포트 | 원인 컬럼 | 해결 컬럼 | 결과 |
|--------|-----------|-----------|------|
| 375px (mobile) | 숨김 | 숨김 | 정상 |
| 768px (tablet) | 표시 (`md:table-cell`) | 숨김 | 정상 |
| 1280px (desktop) | 표시 | 표시 (`lg:table-cell`) | 정상 |

---

## 스크린샷

- `01-empty-state.png` — 검색 전 빈 상태
- `02-list-mode-table.png` — 키워드 없이 전체 목록 (유사도 컬럼 없음)
- `03-sort-active.png` — # 컬럼 정렬 활성 상태 (accent 아이콘)
- `04-search-mode-with-similarity.png` — 키워드 "메모리" 검색 결과 (유사도 컬럼 표시)
- `05-light-mode.png` — 라이트 모드 전환
- `06-mobile-375.png` — 모바일 375px
- `07-tablet-768.png` — 태블릿 768px

---

## 최종 판정: PASS

5개 검증 항목 전부 통과. 지적 사항 없음.
