# Tier 2-3 SOLID 리팩터 — Playwright QA 테스트 케이스

리팩터 직후 회귀 검증을 위한 명세. 각 케이스는 **사용자 플로우 한 단위**이며, "PASS / FAIL / BLOCKED" 중 하나로 판정한다.

---

## 환경

- **URL**: http://localhost:3001
- **API**: http://localhost:8080 (proxied)
- **로그인**: `jeongwonchoi@shinsegae.com` / `1`
- **브라우저**: Playwright Chromium

## 공통 검증 항목 (모든 케이스 마지막에 체크)

- ❶ JavaScript 콘솔 에러 0건 (warning은 허용, error/uncaught는 FAIL)
- ❷ 네트워크 응답 4xx/5xx 0건 (단, /me 401 미인증 케이스는 제외)
- ❸ Dark↔Light 모드 토글 (TopBar Sun/Moon 아이콘) 시 색상 깨짐 없음
- ❹ Sidebar 축소/확장 시 레이아웃 깨짐 없음

---

## TC-1: 로그인 + 대시보드 진입 (전제 조건)

**대상**: `/login` → `/`

**스텝**:
1. http://localhost:3001 접속 → 자동으로 `/login` 리다이렉트 확인
2. email 필드에 `jeongwonchoi@shinsegae.com` 입력
3. password 필드에 `1` 입력
4. "로그인" 버튼 클릭
5. URL이 `/` (대시보드)로 변경 확인

**PASS 기준**: 5초 내 로그인 성공 + 대시보드 시스템 카드 표시 + 콘솔 에러 0

---

## TC-2: ChatPage (Tier 3-3 — 27 useState → 3개 hook 추출)

**대상**: `/chat` (또는 우측 ChatPanel)

### TC-2.1: 페이지 진입 + 새 세션 자동 생성
**스텝**:
1. 좌측 Sidebar에서 "챗봇" 메뉴 클릭 → `/chat` 접근
2. URL이 `/chat`인 것 확인
3. 채팅창에 빈 새 세션이 자동 생성되는지 확인 ("새 대화" 타이틀 노출)

**PASS 기준**: 페이지 로드 후 1초 내 새 세션 자동 생성

### TC-2.2: 메시지 전송 + SSE 스트리밍
**스텝**:
1. composer input에 "안녕" 입력 후 Enter
2. user 메시지 버블 즉시 표시 확인
3. assistant 메시지가 토큰 단위로 스트리밍되는지 확인 (한 글자씩 증가)
4. 스트리밍 중에는 input이 disabled 상태인지 확인
5. 스트리밍 완료 후 input 다시 활성화 확인

**PASS 기준**: 메시지가 토큰 스트림으로 표시 + UI 락/언락 정상

### TC-2.3: 세션 전환 시 in-flight 스트림 취소
**스텝**:
1. 새 세션에서 "긴 답변 부탁해" 입력 후 Enter
2. 스트리밍 진행 중 좌측 세션 목록에서 다른 세션 클릭
3. 이전 세션의 스트리밍이 취소되는지 (네트워크 abort) 확인
4. 새 세션 메시지 이력이 표시되는지 확인

**PASS ∇ 기준**: AbortController가 이전 스트림 취소 + 새 세션으로 전환됨

### TC-2.4: 세션 검색
**스텝**:
1. 좌측 세션 목록 상단 검색 input에 키워드 입력 (예: "테스트")
2. 디바운스 후 결과 필터링 확인
3. 검색 비우기 → 전체 목록 복원

**PASS 기준**: 디바운스 동작 + ILIKE 검색 결과 정상

### TC-2.5: 세션 삭제 + 되돌리기 토스트
**스텝**:
1. 세션 항목 우측 메뉴(...) 클릭 → "삭제" 선택
2. 확인 모달에서 "삭제" 버튼 클릭
3. 토스트 알림 표시 확인 ("세션이 삭제되었습니다 — 되돌리기" 또는 유사 메시지)
4. 토스트 안의 "되돌리기" 클릭 → 세션 복원 확인

**PASS 기준**: 8초 이내 toast 표시 + restore 동작 정상

### TC-2.6: 시스템 필터
**스텝**:
1. 채팅 헤더의 시스템 필터 드롭다운 클릭
2. 시스템 1개 선택 → 채팅 컨텍스트가 해당 시스템으로 제한되는지 확인
3. 메시지 전송 시 페이로드의 system_ids에 선택값 포함되는지 (네트워크 탭) 확인

**PASS 기준**: 시스템 선택 즉시 다음 메시지에 반영

---

## TC-3: SearchVerifyTab (Tier 3-1 — 1,435줄 → 5개 컴포넌트)

**대상**: `/knowledge` (검색 검증 탭)

### TC-3.1: 페이지 진입 + 모드 토글
**스텝**:
1. Sidebar "지식" 메뉴 클릭 → `/knowledge`
2. 탭 중 "검색 검증" 클릭
3. 모드 토글 슬라이더 확인 — "챗봇 검색" / "컬렉션 검색" 두 옵션
4. 두 모드 클릭 시 슬라이딩 인디케이터가 부드럽게 이동

**PASS 기준**: 모드 전환 즉시 컬렉션 체크박스 그룹 노출 변경

### TC-3.2: 챗봇 검색 모드 — 결과 표시
**스텝**:
1. "챗봇 검색" 모드 선택
2. 시스템 다중선택에서 1개 이상 선택
3. 검색 input에 "오류" 입력 후 검색 버튼 클릭
4. 결과 리스트가 점수 순(내림차순)으로 표시되는지 확인
5. ScoreBadge가 각 카드에 표시되는지 확인

**PASS 기준**: 결과 N건 표시 + 점수 정렬 + 빈 결과면 EmptyState 표시

### TC-3.3: 결과 상세 패널 + 마크다운 렌더
**스텝**:
1. 결과 카드 중 1개 클릭 → 상세 패널 (모달) 오픈
2. 패널에 PointIdBadge 표시 확인
3. 본문이 마크다운으로 렌더링되는지 (코드 블록, 리스트, 링크) 확인
4. 닫기 버튼 클릭 시 패널 닫힘

**PASS 기준**: 모달 오픈/닫힘 + 마크다운 정상 렌더

### TC-3.4: 컬렉션 검색 모드 — 컬렉션 체크박스
**스텝**:
1. "컬렉션 검색" 모드로 전환
2. 컬렉션 체크박스 5종(log_incidents, metric_baselines, aggregation_summaries, knowledge_jira, knowledge_confluence) 표시 확인
3. 1~2개 체크 + reranker 토글 ON
4. 검색 실행 → 결과가 컬렉션 별로 라벨 표시

**PASS 기준**: 다중 컬렉션 선택 + reranker 옵션 페이로드 반영

### TC-3.5: 운영자 노트 — 인라인 삭제 확인
**스텝** (data 있을 때):
1. 결과 중 `doc_type=operator_note` 카드 노출 확인
2. 삭제 버튼 클릭 → 인라인 confirm 노출 ("삭제하시겠습니까?" 또는 유사)
3. "취소" 클릭 → confirm 사라짐
4. (옵션) 다시 삭제 → "확인" 클릭 → 삭제 후 결과 갱신

**PASS 기준**: 인라인 confirm 토글 + 데이터 변경 정상 (확인 단계 OK시)

---

## TC-4: AgentFormModal (Tier 3-2 — 904줄 → 컨테이너 + 3개 폼)

**대상**: `/agents` 또는 시스템 상세에서 에이전트 등록

### TC-4.1: 모달 오픈 + 타입 선택
**스텝**:
1. Sidebar "에이전트" 메뉴 → `/agents`
2. "에이전트 등록" 버튼 클릭 → 모달 오픈
3. 타입 선택 영역에 3개 옵션(Synapse / DB / OTel) 노출 확인
4. Synapse 클릭 → SynapseAgentForm 노출
5. DB 클릭 → DbAgentForm 노출 (필드 변경 확인)
6. OTel 클릭 → OtelAgentForm 노출

**PASS 기준**: 타입 전환 시 form 필드 즉시 교체 + 이전 값 비휘발

### TC-4.2: Synapse 폼 — collectors / log_monitors / web_servers
**스텝**:
1. Synapse 타입 선택
2. 시스템 선택 (필수)
3. instance_role 입력 (예: "was1")
4. collectors 체크박스 그룹 — cpu/memory/disk/network/log/web 토글
5. log_monitors 추가 버튼 → 동적 행 추가
6. web_servers 추가 버튼 → 동적 행 추가 + log_format 드롭다운(combined/nginx_json/clf)

**PASS 기준**: 필드 변경 시 label_info JSON 미리보기 또는 동작 정상

### TC-4.3: DB 폼 — db_type별 필드
**스텝**:
1. DB 타입 선택
2. db_type 드롭다운 — oracle/postgresql/mssql/mysql
3. oracle 선택 → service_name 필드 노출
4. postgresql 선택 → database 필드 노출 (oracle service_name → database로 전환)
5. host/port/username/password 입력
6. port 기본값이 db_type에 따라 다른지 확인 (oracle=1521, postgres=5432, mssql=1433, mysql=3306)

**PASS 기준**: db_type 변경 시 식별자 필드 + 기본 포트 자동 변경

### TC-4.4: 필수 필드 검증
**스텝**:
1. (어느 타입이든) 필수 필드 비워두고 "등록" 클릭
2. 필수 필드 에러 메시지 표시 확인
3. 입력 후 다시 클릭 → 정상 진행

**PASS 기준**: 필수 검증 미충족 시 등록 차단 + 시각적 피드백

---

## TC-5: DashboardSystemDetailPage (Tier 3-4 — 893줄 → 5개 파일)

**대상**: 대시보드 → 시스템 카드 클릭 → 상세

### TC-5.1: 페이지 진입 + 메트릭 차트 그리드
**스텝**:
1. `/` (대시보드) → 시스템 카드 1개 클릭
2. URL이 `/dashboard/system/{id}` 또는 유사한 패턴 확인
3. 메트릭 차트 그리드가 그룹별(CPU/Memory/Disk/Network) 표시 확인
4. 각 차트의 단위가 표시되는지 (UNIT_MAP 적용 확인 — %, MB/s 등)

**PASS 기준**: 모든 메트릭 그룹 차트 렌더 + 단위 정상

### TC-5.2: 시간 범위 토글
**스텝**:
1. 시간 범위 토글에서 1h/6h/24h 등 옵션 전환
2. 차트 데이터 다시 조회되는지 (loading 인디케이터 → 새 데이터)
3. 시간축이 선택 범위에 맞게 변경

**PASS 기준**: 옵션 전환 즉시 React Query refetch + 차트 갱신

### TC-5.3: 프로세스 트리맵 (해당 시 표시)
**스텝**:
1. CPU/Memory 사용률 상위 프로세스 트리맵 영역 확인
2. 사각형 크기가 사용률에 비례하는지 확인 (큰 프로세스 = 큰 사각형)
3. hover 시 tooltip에 프로세스명 + 사용률 노출

**PASS 기준**: 트리맵 렌더 + tooltip 동작 (데이터 없으면 EmptyState)

### TC-5.4: 활성 알림 + 로그 분석 + 담당자
**스텝**:
1. 페이지 하단으로 스크롤
2. "활성 알림" 섹션에 최근 메트릭 알림 N건 표시
3. "로그 분석" 섹션에 최근 분석 결과 N건 표시
4. "담당자" 섹션에 시스템 담당자 목록 표시

**PASS 기준**: 모든 4개 섹션 렌더 (데이터 없으면 EmptyState)

---

## TC-6: 공통 — 다크/라이트 + Sidebar 축소

**모든 페이지에서 다음 검증**:

### TC-6.1: 테마 토글
**스텝**:
1. TopBar 우측 Sun/Moon 아이콘 클릭
2. `<html>` 클래스 토글 확인 (`light` 추가/제거)
3. 색상 변화 — 텍스트 가독성 / 배경 대비 정상
4. localStorage `theme` 키 저장 확인
5. 페이지 새로고침 시 선택한 테마 유지

**PASS 기준**: 토글 즉시 모든 토큰 색상 전환 + 영속

### TC-6.2: Sidebar 축소
**스텝**:
1. Sidebar 하단 토글 버튼 클릭 → 축소 모드
2. 메뉴 아이콘만 표시 + 라벨 숨김 확인
3. 컨텐츠 영역 width가 자동 확장되는지 확인
4. 다시 클릭 → 확장 모드 복원

**PASS 기준**: 부드러운 transition + 레이아웃 깨짐 없음

---

## 판정 매트릭스

| 케이스 | 우선순위 | 자동화 가능 | 데이터 의존 |
|---|---|---|---|
| TC-1 | P0 | yes | no |
| TC-2.1 ~ 2.6 | P0 | yes | partial (세션 데이터) |
| TC-3.1 ~ 3.5 | P0 | yes | partial (검색 결과) |
| TC-4.1 ~ 4.4 | P1 | yes | no (form만 검증) |
| TC-5.1 ~ 5.4 | P1 | yes | yes (메트릭 데이터) |
| TC-6.1 ~ 6.2 | P0 | yes | no |

**Total cases**: 21
**90% 합격선**: 19개 이상 PASS (BLOCKED는 자동 PASS 간주 — 데이터 부재 등 환경 사유)

---

## 리포트 형식 (QA agent가 작성)

```
# QA Report — {date} {time}

## Summary
- Total: 21 / Passed: X / Failed: Y / Blocked: Z
- Pass rate: X.X%
- Console errors observed: list of cases
- Network 4xx/5xx: list of cases (excluding /me 401)

## Detail (per case)
- TC-X.Y [PASS/FAIL/BLOCKED]: <one-line summary>
  - 증거: screenshot path 또는 콘솔/네트워크 로그
  - 재현 방법 (FAIL시): step

## 결정
- 90% 기준 충족 여부 (≥19/21 PASS)
- 즉시 패치 필요 항목 (P0 FAIL)
```
