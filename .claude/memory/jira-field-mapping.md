# JIRA 필드 매핑 (AMDP1 프로젝트 기준)

> 출처: `SR통계자료 점검_2025_202602.xlsx` (31컬럼, 8,183행) + JIRA API 직접 검증
> 대상 프로젝트: AMDP1 (백화점CX팀 업무 관리), https://jira.sinc.co.kr
> 최종 업데이트: 2026-05-04 (전 필드 수집 완료)

---

## 엑셀 컬럼 → JIRA 필드 ID 전체 매핑표 (SR통계 31컬럼 기준)

| 엑셀 컬럼 | JIRA 필드 ID | JIRA 필드명 | 타입 | 수집 여부 |
|---|---|---|---|---|
| 프로젝트 | `project.key` | 프로젝트 키 | 표준 | ✅ |
| 요약 | `summary` | 요약 | 표준 | ✅ |
| 이슈 유형 | `issuetype.name` | 이슈 유형 | 표준 | ✅ 변경관리/서비스요청관리 |
| 키 | `key` | 이슈 키 | 표준 | ✅ AMDP1-XXXXX |
| 담당자 | `assignee.displayName` | 담당자 | 표준 | ✅ 임베딩 `[담당자]` |
| 상태 | `status.name` | 상태 | 표준 | ✅ 미해결/해결됨 등 |
| 해결책 | `resolution.name` | 해결책 | 표준 | ✅ 미해결/종료 등 |
| JSM요청자 | `customfield_11500` | JSM요청자 | 커스텀 | ✅ 임베딩 `[요청자]` |
| 변경일 | `updated` | 변경일 | 표준 | ✅ |
| 생성일 | `created` | 생성일 | 표준 | ✅ |
| 설명 | `description` | 설명 | 표준 | ✅ 임베딩 전문 |
| 완료희망일 | `customfield_10437` | 완료희망일 | 커스텀 | ✅ |
| 요청구분 | `customfield_11718` | 요청구분 | 커스텀 | ✅ 서비스요청/변경요청 |
| 합의완료일 | `customfield_10403` | 합의완료일 | 커스텀 | ✅ |
| 해결일 | `resolutiondate` | 해결일 | 표준 | ✅ |
| 시스템명 | `customfield_17903` | 시스템명 | 커스텀 | ✅ 임베딩 `[시스템명]` — list |
| 시작일(cal) | `customfield_11008` | 시작일(cal) | 커스텀 | ✅ |
| 종료예정일(cal) | `customfield_11009` | 종료예정일(cal) | 커스텀 | ✅ |
| 요청생성일 | `customfield_10723` | 요청생성일 | 커스텀 | ✅ |
| 처리유형(변경관리) | `customfield_16460` | 처리유형(변경관리) | 커스텀 | ✅ 임베딩 `[처리유형]` — list |
| 처리유형(서비스요청) | `customfield_16461` | 처리유형(서비스요청) | 커스텀 | ✅ list |
| 시스템 부서 | `customfield_11011` | 시스템부서 | 커스텀 | ✅ 임베딩 `[시스템부서]` — list |
| 접수일 | `customfield_16830` | 접수일 | 커스텀 | ✅ |
| 서비스 | `customfield_17901` | 서비스 | 커스텀 | ✅ 임베딩 `[서비스]` — list |
| 서비스등급 | `customfield_11351` | 서비스등급 | 커스텀 | ✅ Standard/Premium |
| 이슈유형 | `customfield_11343` | 이슈유형(AM) | 커스텀 | ✅ list |
| 업무유형(FTE) | `customfield_15316` | 업무유형(FTE) | 커스텀 | ✅ 임베딩 `[업무유형]` — list |
| 업무구분(FTE) | `customfield_15315` | 업무구분(FTE) | 커스텀 | ✅ 임베딩 `[업무구분]` — list |

---

## 변경관리 전용 추가 필드

| JIRA 필드 ID | 필드명 | 파라미터명 | 설명 |
|---|---|---|---|
| `customfield_16403` | 요건정의서 | `requirements` | text — 임베딩 `[요건정의]` |
| `customfield_16600` | 변경대상 | `change_targets` | text — 임베딩 `[변경대상]` |

---

## 장애관리 전용 추가 필드

| JIRA 필드 ID | 필드명 | 파라미터명 | 설명 |
|---|---|---|---|
| `customfield_18370` | 관계사 | `company` | list — 임베딩 `[관계사]` |
| `customfield_10451` | 장애개요 | `incident_summary` | text — 임베딩 `[장애개요]` |
| `customfield_10454` | 장애원인 | `root_cause` | text — 임베딩 `[장애원인]` |
| `customfield_10452` | 조치사항(I&C/관계사) | `action_taken` | text — 임베딩 `[조치사항]` |
| `customfield_10455` | 해결방안 | `solution` | text — 임베딩 `[해결방안]` |
| `customfield_10453` | 시간대별처리사항 | `action_timeline` | text (표 형식) — 임베딩 `[처리사항]` |
| `customfield_11374` | 장애발생원인 | `incident_cause_type` | 기계적장애/인적장애 등 |
| `customfield_11347` | 장애유형 | `incident_type` | APP/기타/서버 등 — 임베딩 `[장애유형]` |
| `customfield_11368` | 장애영향범위 | `impact_scope` | 낮음/중간/높음 |
| `customfield_11369` | 장애등급 | `grade` | A/B/C/D |
| `customfield_11370` | 귀책사유 | `responsibility` | 당사/당사외 |
| `customfield_11012` | 업무시스템(구) | `business_system` | list |
| `customfield_11311` | 장애발생일시 | `incident_start_at` | datetime |
| `customfield_11362` | 장애인지일시 | `incident_noticed_at` | datetime |
| `customfield_11363` | 장애전파일시 | `incident_notified_at` | datetime |
| `customfield_11366` | 장애시간(분) | `duration_minutes` | float |
| `customfield_10415` | 접수경로 | `reception_channel` | 시스템/전화 등 |

---

## 추가 표준 필드 (엑셀 외 추가 수집)

| JIRA 필드 | 파라미터명 | 설명 |
|---|---|---|
| `reporter.displayName` | `reporter` | 등록자 — 임베딩 `[등록자]` |
| `issuelinks` | `issue_links` | 연관관계 — `_parse_issue_links()` → `[{type, direction, key, issue_type, summary}]` |
| `attachment[].filename` | `attachments` | 첨부파일 목록 (파일명만 저장) |
| `comment[]` | `comments` | 댓글 최대 10개 — 임베딩 전문 |
| `priority.name` | `priority` | 우선순위 (API 반환 null 허용 — UI 기본값과 다를 수 있음) |
| `components[].name` | `components` | 컴포넌트 목록 |
| `customfield_14403` | `difficulty` | 난이도 (상/중/하) — 임베딩 `[난이도]` |

---

## 주요 필드 값 열거형

### 처리유형(변경관리) — customfield_16460
- `[프로그램] UI/서비스/기능` (최다)
- `[DB] 데이터변경(DML)`
- `[프로그램] 배치`
- `단순변경(이미지,문구,CSS/Style,정적코드)`
- `[프로그램] I/F`
- `[DB] Table변경(DDL)`
- 복합 조합 가능 (쉼표 구분 list)

### 처리유형(서비스요청) — customfield_16461
- `데이터추출`
- `단순작업(권한,계정,로그)`

### 업무구분(FTE) — customfield_15315
- `데이터 작업` (35.7%)
- `일반 업무` (24.4%)
- `프로그램개선/개발` (16.3%)
- `운영 업무` (6.6%)
- `정기 업무 지원` / `품질관리` / `프로젝트 지원/관리`

### 업무유형(FTE) — customfield_15316
- `데이터 변경` / `문의 대응` / `데이터 추출`
- `기능변경` / `단순 처리` / `일부개발` / `오류수정`
- `계정 및 권한 처리` / `데이터 이관/적재` / `신규개발` 등

### 서비스등급 — customfield_11351
- `Standard` (99.4%)
- `Premium` (0.6%)

### 시스템 부서 — customfield_11011
- `백화점DX팀`, `백화점CX팀`, `신세계SAP팀`, `신세계POS팀`, `사이먼`

---

## Synapse log-analyzer 현재 구현 상태 (2026-05-04 기준)

### 수집 정책

- **하위 작업 제외** — JQL `AND issuetype not in (subTaskIssueTypes())` 적용. 하위 이슈는 SR통계 커스텀 필드가 없고 상위 이슈와 중복 임베딩 발생
- **SINCAS 내부 ID 자동 제거** — list 타입 커스텀 필드의 `name` 값에 `(SINCAS-130)` 패턴 포함 시 정규식으로 자동 제거 (`_cl()` 헬퍼)
- **null-safe dict 체인** — Jira API가 key 존재·value null 반환 시 `(f.get("field") or {}).get("name")` 패턴으로 방어

### 현재 수집 중인 전체 파라미터 (`upsert_jira_issue`)

**표준 필드:**

| 파라미터명 | JIRA 필드 | 임베딩 포함 |
|---|---|---|
| `project` | `project.key` | — |
| `issue_id` | `id` | — |
| `issue_key` | `key` | — |
| `title` | `summary` | ✅ `[project] title` |
| `description` | `description` | ✅ 전문 |
| `status` | `status.name` | — |
| `comments` | `comment[]` (최대 10개) | ✅ 전문 |
| `issue_type` | `issuetype.name` | ✅ `[유형]` |
| `priority` | `priority.name` | — |
| `components` | `components[].name` | — |
| `resolution_date` | `resolutiondate` | — |
| `resolution` | `resolution.name` | — |
| `assignee` | `assignee.displayName` | ✅ `[담당자]` |
| `reporter` | `reporter.displayName` | ✅ `[등록자]` |
| `created_at` | `created` | — |
| `updated_at` | `updated` | — |
| `issue_links` | `issuelinks` | — | `{type, direction, key, issue_type, summary}` 리스트 |
| `attachments` | `attachment[].filename` | — |

**커스텀 필드 — 공통:**

| 파라미터명 | JIRA 필드 ID | 필드명 | 임베딩 포함 |
|---|---|---|---|
| `jsm_requester` | `customfield_11500` | JSM요청자 | ✅ `[요청자]` |
| `jira_systems` | `customfield_17903` | 시스템명 | ✅ `[시스템명]` |
| `due_date` | `customfield_10437` | 완료희망일 | — |
| `agreed_date` | `customfield_10403` | 합의완료일 | — |
| `start_date` | `customfield_11008` | 시작일(cal) | — |
| `end_date` | `customfield_11009` | 종료예정일(cal) | — |
| `request_created_at` | `customfield_10723` | 요청생성일 | — |
| `received_at` | `customfield_16830` | 접수일 | — |
| `company` | `customfield_18370` | 관계사 | ✅ `[관계사]` |
| `system_dept` | `customfield_11011` | 시스템부서 | ✅ `[시스템부서]` |
| `service` | `customfield_17901` | 서비스 | ✅ `[서비스]` |
| `fte_category` | `customfield_15315` | 업무구분(FTE) | ✅ `[업무구분]` |
| `fte_type` | `customfield_15316` | 업무유형(FTE) | ✅ `[업무유형]` |
| `difficulty` | `customfield_14403` | 난이도 | ✅ `[난이도]` |
| `service_grade` | `customfield_11351` | 서비스등급 | — |
| `request_type` | `customfield_11718` | 요청구분 | — |
| `issue_type_am` | `customfield_11343` | 이슈유형(AM) | — |
| `change_process_type` | `customfield_16460` | 처리유형(변경관리) | ✅ `[처리유형]` |
| `sr_process_type` | `customfield_16461` | 처리유형(서비스요청) | — |

**커스텀 필드 — 변경관리 전용:**

| 파라미터명 | JIRA 필드 ID | 필드명 | 임베딩 포함 |
|---|---|---|---|
| `requirements` | `customfield_16403` | 요건정의서 | ✅ `[요건정의]` |
| `change_targets` | `customfield_16600` | 변경대상 | ✅ `[변경대상]` |

**커스텀 필드 — 장애관리 전용:**

| 파라미터명 | JIRA 필드 ID | 필드명 | 임베딩 포함 |
|---|---|---|---|
| `incident_summary` | `customfield_10451` | 장애개요 | ✅ `[장애개요]` |
| `action_taken` | `customfield_10452` | 조치사항(I&C/관계사) | ✅ `[조치사항]` |
| `action_timeline` | `customfield_10453` | 시간대별처리사항 | ✅ `[처리사항]` |
| `root_cause` | `customfield_10454` | 장애원인 | ✅ `[장애원인]` |
| `solution` | `customfield_10455` | 해결방안 | ✅ `[해결방안]` |
| `reception_channel` | `customfield_10415` | 접수경로 | — |
| `incident_cause_type` | `customfield_11374` | 장애발생원인 | — |
| `incident_type` | `customfield_11347` | 장애유형 | ✅ `[장애유형]` |
| `impact_scope` | `customfield_11368` | 장애영향범위 | — |
| `grade` | `customfield_11369` | 장애등급 | — |
| `responsibility` | `customfield_11370` | 귀책사유 | — |
| `business_system` | `customfield_11012` | 업무시스템(구) | — |
| `incident_start_at` | `customfield_11311` | 장애발생일시 | — |
| `incident_noticed_at` | `customfield_11362` | 장애인지일시 | — |
| `incident_notified_at` | `customfield_11363` | 장애전파일시 | — |
| `duration_minutes` | `customfield_11366` | 장애시간(분) | — |

### 미수집 필드

SR통계 31컬럼 기준 전체 수집 완료. 추가 수집이 필요한 필드는 현재 없음.

---

## 데이터 규모 (2026-02 기준)
- 총 이슈: 8,183건 (general_report 시트)
- 이슈 유형: 서비스요청관리 83.7% / 변경관리 16.3%
- 주요 프로젝트: 백화점DX팀(37.9%), 백화점CX팀(29.6%), 신세계SAP팀(16.5%), 신세계POS팀(16.1%)
