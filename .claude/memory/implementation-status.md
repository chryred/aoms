# 현재 구현 상태

| Phase | 상태 | 내용 |
|---|---|---|
| Phase 1 | 완료 | 인프라 (Prometheus, Grafana, Alertmanager, Postgres) — Loki 제거 |
| Phase 2 | 완료 | admin-api, Teams 알림 |
| Phase 3 | 완료 | 에이전트 배포 (synapse_agent로 대체됨) |
| Phase 4 | 완료 | log-analyzer, LLM 분석 |
| Server B | 완료 | Ollama + Qdrant 배포 |
| Phase 4b | 완료 | 벡터 유사도 분석 (log_incidents 컬렉션) |
| Phase 4c | 완료 → 이관 | n8n 12종 워크플로우 중 WF1/WF6~WF11은 log-analyzer 스케줄러로, WF2/WF3/WF12는 admin-api·frontend 직결로 이관·제거. WF4/WF5는 보류(JSON만 보존). n8n 컨테이너는 미사용 유지 (ADR-006) |
| Phase 5 | 완료 | 계층적 메트릭 집계 (시간/일/주/월) + 장애 예방 시스템 (수집기 유연 레지스트리, 집계 벡터 검색, 프로액티브 알림) |
| Frontend UI | 완료 | React + 뉴모피즘 프론트엔드 (20개 화면) — 분석 탭, 피드백 관리, 벡터 컬렉션 상태 포함 |
| Phase 4d | 계획 | Agentic LLM 2-tier (ReAct 루프) |
| Phase 6 (synapse_agent) | 완료 | Rust 단일 바이너리 수집기 (CPU/메모리/디스크/네트워크/프로세스/로그/웹서버 access log), Prometheus Remote Write, WAL 2h 버퍼 |
| Phase 6 (admin-api) | 완료 | synapse_agent install 자동화 (config.toml SFTP 업로드), live-status API (Prometheus 쿼리), prometheus_analyzer.py 자동 분석 루프. collector_config._TEMPLATES에 synapse_agent 추가 |
| Phase 6 (frontend) | 완료 | AgentDetailPage live-status 카드 — 수집기별 활성 뱃지, last_seen 표시 |
| Phase 6 (log-analyzer) | 완료 | aggregation_processor.PROMQL_MAP에 synapse_agent 추가 (cpu/memory/disk/network/log/web). _detect_anomaly synapse_agent 조건 추가. analyze_with_llm() dead code 제거 |
| Phase 7 | 완료 | `instance_role` HA 의미 재정립, `[[log_monitor]]` 다중 log_type 지원, log-analyzer Loki→Prometheus 마이그레이션, Loki 컨테이너 완전 제거 |
| Phase 8 (dashboard) | 완료 | 통합 운영 대시보드 — 하이브리드 레이아웃(통계+카드), 시스템 상태 종합 판정(메트릭+로그분석+예방패턴), WebSocket 실시간 알림 스트리밍, 예방적 패턴 감지 연동, 단위 테스트 13개 |
| Phase 9 (DB 모니터링) | 완료 | `agent_type='db'` 통합 — `db_type`(oracle/postgresql/mssql/mysql)별 Strategy+Registry 패턴 수집, Fernet 암호화, /metrics Prometheus scrape 엔드포인트, collector_config 자동 등록 |
| Phase 9 (UI 정리) | 완료 | 수집기 마법사 UI 제거 (CollectorWizardPage, CollectorConfigListPage, collector/ 컴포넌트), Sidebar "수집기 설정" 메뉴 제거, node_exporter/jmx_exporter PROMQL_MAP 및 _TEMPLATES에서 제거 |
| Phase 10 (LLM 파이프라인 강건화) | 완료 | ADR-001~005 반영 — Strategy 패턴 일원화, error_message 컬럼 + UI 뱃지, 임베딩 경량화(paraphrase-multilingual 768dim), Qdrant 컬렉션 부팅 자동 보증, no_logs 카운터 분리 |
| OTel+Tempo (Phase 0~5) | 완료 | ADR-008 — Tempo 2.9.1 + OTel Collector 0.123.0 인프라, OTel Java Agent 자동 설치(SFTP), trace context LLM 주입, Frontend APM UI (TraceDotChart·TraceDetailPanel·OtelAgentInstallForm·추적 탭), AlertDetailPanel related_trace_ids 표시, DB 마이그레이션 3중 동기화 |
| Incident Lifecycle | 완료 | 인시던트 자동 그루핑 (30분 윈도우, 같은 system) + 상태 전이(open→acknowledged→investigating→resolved→closed) + MTTA/MTTR 측정. `incidents` / `incident_timeline` 테이블, `alert_history`·`log_analysis_history`에 `incident_id` FK. Teams 카드에 "인시던트 보기" 버튼 추가. Frontend: IncidentListPage + IncidentDetailPage (상태 전환 버튼, 타임라인, 근본원인/조치/사후분석 입력). 단위 테스트 8개. |
| Synapse CLI 채널 | 완료 | 운영자 터미널에서 LLM 직접 질의. 단방향(`synapse ask`) + 양방향(`synapse chat`, 기존 ReAct 재활용). PyInstaller 단일 바이너리, Docker 멀티스테이지 빌드로 admin-api 이미지에 번들. CLI 관리 페이지(/admin/synapse-cli) — SSH 배포 인프라 재활용. `POST /api/v1/llm/query` 신규. `agent_type="cli"` 추가. auth.py X-Client: cli 헤더 지원. |
| Wave 2A (인시던트 피드백 전환) | 완료 | 피드백 워크플로우를 alert_history 기반에서 인시던트 단위로 전환. `routes/incidents.py`에 8개 엔드포인트 추가 (GET /stats, GET /feedback/pending, GET /feedback/search, POST /{id}/feedback, POST /{id}/feedback/{fid}/approve, POST /{id}/feedback/{fid}/reject, POST /{id}/feedback/{fid}/resubmit, GET /{id}/feedback). `routes/feedback.py` — /upload + /attachments/{path} 유지, 나머지 전부 410 Gone. `services/incident_postmortem_client.py` 신규 (embed_postmortem/search_postmortem/trigger_ocr). approve 핸들러: OR 권한(admin 또는 지정 승인자), 425 OCR wait, Qdrant upsert, 승인자 async load (MissingGreenlet 방지). 테스트: `test_incident_feedback.py` 12건, `test_feedback_search.py` → 410 검증으로 교체. |
| P2-C (force re-sync 비동기화) | 완료 | Jira/Confluence 단건 강제 재동기화 엔드포인트를 동기 블로킹(60s timeout)에서 비동기 Job 패턴(202 즉시 반환)으로 전환. `knowledge_sync_jobs` 테이블 신규(admin-api 소유 — log-analyzer는 DB 없음). 3중 동기화: `models.py` + `init.sql` + `migrations/20260511_add_sync_jobs.sql`. `routes/knowledge.py`: force POST → 202+job_id, 중복 idempotent 가드, `asyncio.create_task(_run_sync_job)` 백그라운드 실행, GET /sync/jobs/{job_id} + GET /sync/jobs(admin). `knowledge_service.py`: `call_force_sync_jira_raw` / `call_force_sync_confluence_raw`(90s timeout, 내부용). Frontend: `SyncJobCreated`/`SyncJobStatus` 타입, `useSyncJob` 폴링 훅(done/failed 자동 중지), `useForceSync` mutation, `qk.knowledge.syncJob` 쿼리키, `useSearchVerifyLogic.handleResync` 토스트 업데이트. 테스트 6건 추가, 전체 430 통과. |
