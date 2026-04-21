# Synapse-V 개선 아이디어

> 현재 구현 현황(Phase 1~10, OTel/Tempo, Chat Agent)을 기반으로 도출한 개선 방향.
> 우선순위는 구현 난이도와 운영 임팩트를 함께 고려한 순서.

---

## 1. 인시던트 라이프사이클 관리 ★ (최우선)

### 배경
현재 `alert_history` / `log_analysis_history`는 개별 이벤트로만 저장된다.
동일 장애에서 발생한 여러 알림이 "하나의 사건"으로 묶이지 않아 MTTR 측정, 재발 추적, 담당자 공동 대응이 어렵다.

### 목표
- 관련 알림·로그분석을 하나의 **인시던트**로 자동 그루핑
- 상태 전이: `open → acknowledged → investigating → resolved → closed`
- MTTA / MTTR 자동 측정 → 운영 리포트 반영
- 재발 감지 및 이전 인시던트 연결 (기존 Qdrant 유사도 재활용)

### 주요 변경
| 영역 | 변경 내용 |
|---|---|
| DB | `incidents`, `incident_timeline` 테이블 추가. `alert_history` / `log_analysis_history`에 `incident_id` FK 추가 |
| admin-api | `alerts.py` / `analysis.py` 수신 시 `get_or_create_incident()` 자동 그루핑. `/api/v1/incidents` CRUD 엔드포인트 |
| Teams | 알림 카드에 **"인시던트 보기"** 버튼 추가 (기존 "해결책 등록" 유지) |
| Frontend | 인시던트 목록 페이지 + 상세 페이지(타임라인, 상태 전환, 근본원인/조치 입력) |

### 기존 기능 연계 개선
- **알림 이력**: 인시던트 배지 + 재발 표시 추가
- **피드백(해결책 등록)**: 인시던트 해결 시 연결 알림 전체에 해결책 일괄 등록 가능
- **해결책 검색**: 검색 범위를 `root_cause` / `postmortem`까지 확장. 재발 방지 효과 기반 정렬

---

## 2. Capacity Planning (고갈 예측)

### 배경
현재 `metric_daily_aggregations`에 CPU/메모리/디스크 집계 데이터가 쌓이고 있으나,
미래 고갈 시점을 예측하는 로직이 없다.

### 목표
- 디스크/메모리의 N일 추세를 선형 회귀로 분석해 **"X일 후 임계치 도달"** 예측
- 예방 Teams 알림: "CRM 서버 디스크 현 추세면 14일 내 90% 도달 예상"
- 대시보드에 고갈 예측 위젯 추가

### 주요 변경
| 영역 | 변경 내용 |
|---|---|
| log-analyzer | `_daily_agg_scheduler` 완료 후 최근 14일 기울기 계산 → `days_until_threshold` 저장 |
| admin-api | `metric_daily_aggregations`에 `predicted_threshold_days` 컬럼 추가. 14일 이내 예측 시 Teams 발송 |
| Frontend | 대시보드 시스템 카드에 "D-14" 스타일 고갈 예측 배지 |

---

## 3. AI Runbook 자동 생성

### 배경
알림 유형별 대응 절차(Runbook)가 담당자 개인 지식에 의존한다.
이미 LLM + Qdrant 인프라가 갖춰져 있어 추가 인프라 없이 구현 가능하다.

### 목표
- 신규 알림/인시던트 발생 시 LLM이 대응 절차 초안 자동 생성
- 운영자 검토 후 Runbook으로 저장 → 유사 인시던트 발생 시 자동 첨부
- 챗 에이전트가 Runbook을 도구로 활용 가능

### 주요 변경
| 영역 | 변경 내용 |
|---|---|
| DB | `runbooks` 테이블 (`title`, `content`, `alert_type`, `vector_id`) |
| admin-api | 인시던트 생성 시 유사 Runbook 벡터 검색 → 없으면 LLM 초안 생성 |
| Qdrant | `runbooks` 컬렉션 추가 (768차원, paraphrase-multilingual) |
| Frontend | Runbook 관리 페이지 + 인시던트 상세에 Runbook 패널 |

---

## 4. Alert Correlation / 연쇄 장애 그루핑

### 배경
같은 시간대 여러 시스템의 CPU 급증 + 로그 에러 + DB 지연이 터지면 Teams 알림이 폭주한다.
현재 `prometheus_analyzer`가 교차 분석을 하지만 알림은 여전히 개별 발송된다.

### 목표
- 5분 내 동일 시스템군(또는 의존 관계)에서 발생한 복수 알림 → **1개 인시던트로 자동 묶기**
- Teams 알림 피로도 감소: "CRM·POS·결제 시스템 연쇄 이상 감지 (3개 알림 그룹)" 1장으로 통합

### 주요 변경
| 영역 | 변경 내용 |
|---|---|
| admin-api | `alerts.py` 수신 시 동일 시간 윈도우 내 연관 인시던트 탐색 범위를 시스템 그룹으로 확장 |
| DB | `system_groups` 테이블 (시스템 간 의존 관계 메타데이터) 또는 `systems.group_tag` 컬럼 추가 |
| Teams | 그룹 알림 카드 템플릿 (여러 시스템 한 장에 표시) |

---

## 5. Maintenance Window (유지보수 시간 알림 억제)

### 배경
유지보수 중에도 알림이 계속 발생해 Teams가 노이즈로 가득 찬다.

### 목표
- 운영팀이 사전에 유지보수 시간대 등록 (시스템 단위 or 전체)
- 해당 시간 동안 Teams 알림 자동 억제 (이력은 저장)
- 유지보수 종료 후 억제된 알림 요약 1장 발송

### 주요 변경
| 영역 | 변경 내용 |
|---|---|
| DB | `maintenance_windows` 테이블 (`system_id`, `start_at`, `end_at`, `reason`) |
| admin-api | `cooldown.py`에 유지보수 윈도우 체크 로직 추가. 억제된 알림 카운트 집계 |
| Frontend | 시스템 상세 페이지에 유지보수 등록 UI |

---

## 6. 에스컬레이션 정책 자동화 (WF5 이관)

### 배경
`n8n-workflows/WF5-escalation.json`이 보류 상태로 존재한다.
30분 내 미해결 인시던트를 다음 담당자 또는 관리자에게 자동 에스컬레이션하는 로직이 없다.

### 목표
- 인시던트 `open` 상태가 N분 지속 시 → 2차 담당자/관리자 Teams 멘션
- 에스컬레이션 정책을 시스템별로 설정 가능 (critical: 15분, warning: 60분)
- WF5 로직을 log-analyzer 스케줄러로 이관

### 주요 변경
| 영역 | 변경 내용 |
|---|---|
| DB | `escalation_policies` 테이블 또는 `systems`에 `escalation_minutes` 컬럼 추가 |
| log-analyzer | `_escalation_scheduler()` 추가 — 미해결 인시던트 스캔 → admin-api 에스컬레이션 트리거 |
| admin-api | `POST /api/v1/incidents/{id}/escalate` 엔드포인트 |

---

## 구현 우선순위 요약

| 순위 | 기능 | 이유 |
|---|---|---|
| **1** | 인시던트 라이프사이클 | 가장 넓은 범위의 기존 기능 개선 효과. 기반이 되는 허브 구조 |
| **2** | Capacity Planning | 기존 집계 데이터 재활용. 추가 인프라 불필요 |
| **3** | Maintenance Window | 구현 단순. 운영 노이즈 즉시 감소 |
| **4** | Alert Correlation | 인시던트 기반 위에 구현하면 자연스럽게 통합 |
| **5** | AI Runbook | LLM/Qdrant 인프라 재활용. 중장기 가치 높음 |
| **6** | 에스컬레이션 자동화 | WF5 기존 설계 존재. 인시던트 완성 후 연동 |
