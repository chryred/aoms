# AOMS 구현 워크플로우 — 인덱스

> **문서 버전**: v2.2
> **작성일**: 2026-03-15
> **기반 문서**: [아키텍처 설계서](./architecture-design.md)
> **목표**: 5 Phase에 걸쳐 백화점 13개 시스템 통합 모니터링 시스템 구축

---

## 환경 요약

| 항목 | 내용 |
|---|---|
| **네트워크 환경** | 폐쇄망 (인터넷 차단, 내부망만 사용) |
| **모니터링 서버 OS** | RedHat 8.9 (Docker Compose 설치) |
| **대상 서버 OS** | RedHat 8.9 (Linux), Windows Server (혼합) |
| **파일 준비 환경** | macOS (인터넷 연결 가능 — 이미지/바이너리 사전 다운로드) |
| **알림 채널** | Microsoft Teams (Incoming Webhook) |
| **LLM** | 내부 LLM API (HTTP 호출, 외부 전송 없음) |

---

## 단계별 파일 목록

> 각 파일을 Claude에 첨부하여 해당 단계만 요청하세요.

### [Phase 0 — 사전 준비](./workflow/1.phase0-prep.md)
- Docker 이미지 Pull & Save (Mac)
- 에이전트 바이너리 다운로드 (Linux/Windows)
- Python 패키지 오프라인 다운로드
- Trivy 오프라인 DB 다운로드
- CRLF → LF 변환 및 체크섬 생성
- 이중화 시스템 라벨링 규칙 (`system_name` + `instance_role`)

### [Phase 1-1 — 인프라 설정 파일 작성](./workflow/2.phase1-config.md)
- T1.1 모니터링 서버 환경 준비 (Docker 설치, 방화벽)
- T1.2 Docker 이미지 Load (폐쇄망)
- T1.3 프로젝트 디렉토리 구조 생성
- T1.4 Prometheus 설정 파일 작성 (Basic Auth 포함)
- T1.5 Alertmanager 설정 파일 작성 (Teams Webhook)
- T1.6 Loki 설정 파일 작성
- T1.7 Grafana 설정 작성 (HTTPS/SSL)
- T1.8 docker-compose.yml 작성

### [Phase 1-2 — PostgreSQL 초기화 & 스택 기동](./workflow/3.phase1-deploy.md)
- T1.9 PostgreSQL 상세 초기화 (스키마, 튜닝)
- T1.10 전체 스택 기동 & 헬스 체크
- T1.11 파일럿 에이전트 설치 (자동 설치 스크립트)
- T1.12 수집 확인 및 기본 대시보드
- CP1 Phase 1 체크포인트

### [Phase 2 — 알림 체계 구축 (Teams 연동)](./workflow/4.phase2-alerts.md)
- Teams Incoming Webhook 설정
- T2.1~T2.2 Admin API 초기화 & DB 스키마
- T2.3 Teams 알림 발송 서비스
- T2.4 Alertmanager Webhook 수신 엔드포인트
- T2.5 E2E 알림 테스트
- CP2 Phase 2 체크포인트

### [Phase 3 — 전체 시스템 확장](./workflow/5.phase3-scale.md)
- T3.1 전체 시스템 에이전트 배포
- T3.2~T3.5 DB/WAS/웹서버 Exporter 설치
- T3.6 Prometheus scrape 설정 전체 확장
- CP3 Phase 3 체크포인트

### [Phase 4 — LLM 로그 분석 서비스](./workflow/6.phase4-llm.md)
- T4.3 Loki 3.x API 로그 조회
- T4.4 담당자별 LLM API key 분리 (AI 비용 분리 청구)
- T4.5 LLM 프롬프트 설계
- T4.7 Teams 알림 발송 (LLM 분석 결과)
- T4.8 오류 피드백 수집 서버 → Phase 4c n8n으로 대체
- T4.9 LLM 분석 cron 등록 → Phase 4c n8n으로 대체
- CP4 Phase 4 체크포인트

### [Server B 구축 — Qdrant & Ollama 배포](./workflow/7.phase-serverb.md)
- SB.1 Server B 환경 준비 (RedHat 8.9, Docker)
- SB.2 Docker 이미지 Load (Qdrant, Ollama)
- SB.3 Ollama 배포 + bge-m3 임베딩 모델 로드
- SB.4 Qdrant 배포 + log_incidents 컬렉션 생성 (int8 양자화)
- SB.5 Server A ↔ Server B 방화벽 설정
- SB.6 통합 E2E 연결 테스트

### [Phase 4b — 벡터 DB 유사도 분석](./workflow/8.phase4b-vector.md)
- T4.10 로그 정규화 + Ollama 임베딩 클라이언트
- T4.11 Qdrant 벡터 저장 & 유사 검색 클라이언트
- T4.12 5분 집계 대표 벡터 생성 파이프라인
- T4.13 이상 분류 로직 (new/recurring/related/duplicate)
- T4.14 LLM 프롬프트 컨텍스트 강화 (유사 이력 + 해결책)
- T4.15 이상 분류별 Teams 알림 차별화
- CP4b Phase 4b 체크포인트

### [Phase 4c — n8n 자동화](./workflow/9.phase4c-n8n.md)
- n8n 컨테이너 추가 (docker-compose.yml)
- 워크플로우 1: 로그 분석 트리거 (5분 주기, cron 대체)
- 워크플로우 2: 메트릭 이상 벡터 검색 (Alertmanager Webhook)
- 워크플로우 3: 피드백 등록 처리 (Flask :8081 대체)
- 워크플로우 4: 일일 이상 리포트 (매일 08:00)
- 워크플로우 5: 반복 이상 에스컬레이션 (30분 주기)
- CP4c n8n 워크플로우 검증 체크포인트

### [Phase 4d — Agentic LLM 심층 분석](./workflow/10.phase4d-agent.md)
- T4d.1 모드 분리 설계 (vector 즉시 알림 + react 심층 분석 2-tier)
- T4d.2 DB 스키마 마이그레이션 (agent_tools, react_analysis_locks)
- T4d.3 동적 도구 레지스트리 (Admin API CRUD, 재배포 없는 도구 추가)
- T4d.4 프롬프트 기반 ReAct 루프 (LLM API 제약 없음, 최대 5회 반복)
- T4d.5 중복 실행 방지 (PostgreSQL TTL 잠금, 4가지 시나리오 대응)
- T4d.6 신규 Python 파일 구조 (6개 파일, 기존 함수 재사용)
- T4d.7 Teams 알림 2단계 설계 (즉시 + 심층 follow-up)
- T4d.8 환경 변수 및 docker-compose 변경
- CP4d Phase 4d 체크포인트

### [Phase 5 — 고도화 & 최종 완성](./workflow/11.phase5-final.md)
- T5.1 대시보드 완성 (이중화 드릴다운)
- T5.2 Self-Monitoring
- T5.3 최종 통합 테스트
- CP5 최종 인수 체크포인트

---

## 전체 태스크 요약

| Phase | 태스크 수 | 주요 산출물 |
|---|---|---|
| 사전 준비 | 7 | 이미지/바이너리/pip 패키지, Trivy DB, CRLF 변환, 폐쇄망 전송 |
| Phase 1 | 12 | docker-compose (Basic Auth, HTTPS, SELinux), PLG 스택, 자동 설치 스크립트 |
| Phase 2 | 5 | Admin API, Teams Adaptive Card 알림, 억제 규칙 |
| Phase 3 | 6 | 전체 에이전트 배포 (Grafana Alloy, node_exporter, jmx_exporter), DB/WAS Exporter |
| Phase 4 | 12 | Log Analyzer (Loki 3.x, PII 마스킹, 재시도), 담당자별 API key |
| Server B | 6 | Qdrant + Ollama 배포 (int8 양자화, bge-m3 GGUF, 폐쇄망 구축) |
| Phase 4b | 6 | 벡터 유사도 분석 (이상 분류, LLM 컨텍스트 강화, Teams 차별화) |
| Phase 4c | 5 | n8n 5종 워크플로우 (cron 통합, 피드백, 일일리포트, 에스컬레이션) |
| Phase 4d | 8 | Agentic LLM (2-tier 분리, ReAct 루프, 동적 도구 레지스트리, TTL 잠금) |
| Phase 5 | 5 | 대시보드 완성, Self-monitoring, 최종 검증, 중기 확장 로드맵 |
| **합계** | **59** | — |

---

## v2.0 주요 변경사항

- Docker 이미지 최신화: Prometheus v3.10.0, Alertmanager v0.31.1, Grafana 12.4.0, Loki 3.6.7
- 바이너리 최신화: node_exporter v1.10.2, Grafana Alloy v1.8.3 (Promtail 대체), Trivy v0.69.3
- Mac→Linux 플랫폼 구분: `--platform linux/amd64` 명시, CRLF→LF 변환
- **Promtail → Grafana Alloy 교체**: Promtail v3.x의 glibc 2.34+ 의존성이 RHEL 8.9(glibc 2.28)와 비호환 → Alloy(glibc 독립)로 대체
- Grafana Alloy: 멀티라인 처리 + 빈줄 제거 + 에러 키워드 필터(RE2) + 레벨 라벨 추출 + JEUS ACL 자동 설정
- 보안 강화: Prometheus Basic Auth, Grafana HTTPS/SSL, SELinux `:z`, Trivy 보안 스캔
- Alertmanager 억제 규칙 (inhibit_rules): Critical 발생 시 Warning 억제
- LLM 분석기 개선: Loki 3.x API 정합성, PII 마스킹, 재시도 로직
- 오류 피드백 수집 서버 (Flask, 포트 8081) → Phase 4c n8n Webhook으로 대체
- 담당자별 LLM API key 분리 (AI 비용 분리 청구)
- **v2.1 추가**: 벡터 DB 유사도 분석 (Qdrant on-disk + int8 양자화, 526만 벡터/년)
- **v2.1 추가**: Ollama bge-m3 GGUF 임베딩 서비스 (Server B, 폐쇄망)
- **v2.1 추가**: n8n 통합 자동화 (5종 워크플로우, cron 전면 대체)
- **v2.1 추가**: 2-서버 아키텍처 (Server A: 모니터링, Server B: AI/데이터)
- **v2.2 추가**: Agentic LLM 2-tier 분석 (vector 즉시 알림 + react 심층 분석 분리)
- **v2.2 추가**: 프롬프트 기반 ReAct 루프 (내부 LLM API 제약 없음, 최대 5회 자율 추론)
- **v2.2 추가**: PostgreSQL 동적 도구 레지스트리 (재배포 없는 도구 추가/수정)
- **v2.2 추가**: per-system TTL 잠금 (5분 주기 n8n 중복 실행 방지)

---

> **구현**: `/sc:implement`로 진행
> **폐쇄망**: 모든 바이너리/이미지는 Mac에서 사전 준비 후 내부망으로 전송
> **이중화**: `system_name`(논리명) + `instance_role`(서버 구분)으로 모든 계층에서 일관 관리
> **보안**: Prometheus Basic Auth + Grafana HTTPS + SELinux `:z` + Trivy 이미지 스캔
