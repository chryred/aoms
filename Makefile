SHELL := /bin/bash

ROOT_DIR      := $(shell pwd)
MAIN_SERVER   := $(ROOT_DIR)/main-server
ADMIN_API_DIR := $(MAIN_SERVER)/services/admin-api
ANALYZER_DIR  := $(MAIN_SERVER)/services/log-analyzer
VENV          := $(ROOT_DIR)/venv
PYTHON        := $(VENV)/bin/python
PIP           := $(VENV)/bin/pip
UVICORN       := $(VENV)/bin/uvicorn

ENV_FILE      := $(MAIN_SERVER)/.env.local

.DEFAULT_GOAL := help

# ── 도움말 ──────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo ""
	@echo "AOMS 로컬 개발 명령어"
	@echo "────────────────────────────────────────────────"
	@echo "  인프라"
	@echo "    make dev-up         로컬 인프라 시작 (postgres, loki, qdrant 등)"
	@echo "    make dev-down       로컬 인프라 중지"
	@echo "    make dev-clean      인프라 중지 + 볼륨 삭제 (DB 초기화)"
	@echo "    make dev-logs       인프라 로그 스트리밍"
	@echo "    make dev-ps         실행 중인 컨테이너 상태 확인"
	@echo ""
	@echo "  앱 실행 (hot-reload)"
	@echo "    make run-api        admin-api 실행 (포트 8080)"
	@echo "    make run-analyzer   log-analyzer 실행 (포트 8000)"
	@echo ""
	@echo "  테스트 (단위)"
	@echo "    make test-api       admin-api 단위 테스트"
	@echo "    make test-all       전체 테스트"
	@echo ""
	@echo "  테스트 데이터 주입 (실서버 없이 전체 파이프라인 검증)"
	@echo "    make seed-db            테스트 시스템+담당자 DB 등록 (1회)"
	@echo "    make test-metric        Alertmanager 형식 메트릭 알림 주입"
	@echo "    make reset-cooldown     5분 쿨다운 초기화 (test-metric 재실행용)"
	@echo "    make push-logs          Loki에 ERROR 로그 직접 주입"
	@echo "    make trigger-analysis   log-analyzer 분석 수동 트리거"
	@echo "    make inject-analysis    분석 결과 직접 주입 (LLM/Loki 우회)"
	@echo "    make test-metric-alert  seed-db + test-metric 합성"
	@echo "    make test-log-pipeline  seed-db + push-logs + trigger-analysis 합성"
	@echo "    make test-inject        seed-db + inject-analysis 합성"
	@echo "    make test-all-inject    전체 파이프라인 순차 실행"
	@echo ""
	@echo "  의존성"
	@echo "    make install        venv에 개발 의존성 설치"
	@echo "    make install-api    admin-api 의존성만 설치"
	@echo "    make install-analyzer log-analyzer 의존성만 설치"
	@echo ""
	@echo "  빌드 (운영 배포용)"
	@echo "    make build          Docker 이미지 빌드 (admin-api, log-analyzer)"
	@echo "    make build-api      admin-api 이미지만 빌드"
	@echo "    make build-analyzer log-analyzer 이미지만 빌드"
	@echo ""
	@echo "  기타"
	@echo "    make env-setup      .env.local 초기 설정"
	@echo "    make db-shell       postgres 쉘 접속"
	@echo "    make health         실행 중인 서비스 헬스체크"
	@echo "────────────────────────────────────────────────"
	@echo ""

# ── 환경 설정 ────────────────────────────────────────────────────────────────
.PHONY: env-setup
env-setup:
	@if [ ! -f $(ENV_FILE) ]; then \
		cp $(MAIN_SERVER)/.env.local.example $(ENV_FILE); \
		echo "✓ .env.local 생성 완료 — 값을 채워주세요: $(ENV_FILE)"; \
	else \
		echo "이미 존재함: $(ENV_FILE)"; \
	fi

# ── 인프라 (Docker) ──────────────────────────────────────────────────────────
.PHONY: dev-up
dev-up:
	@echo "→ 로컬 인프라 시작..."
	cd $(MAIN_SERVER) && docker compose -f docker-compose.dev.yml up -d
	@echo "✓ 완료"
	@echo "  postgres    : localhost:5432"
	@echo "  loki        : localhost:3100"
	@echo "  prometheus  : localhost:9090"
	@echo "  alertmanager: localhost:9093"
	@echo "  qdrant      : localhost:6333"

.PHONY: dev-down
dev-down:
	cd $(MAIN_SERVER) && docker compose -f docker-compose.dev.yml down

.PHONY: dev-clean
dev-clean:
	@echo "⚠ 볼륨까지 삭제됩니다 (DB 데이터 초기화)"
	cd $(MAIN_SERVER) && docker compose -f docker-compose.dev.yml down -v

.PHONY: dev-logs
dev-logs:
	cd $(MAIN_SERVER) && docker compose -f docker-compose.dev.yml logs -f

.PHONY: dev-ps
dev-ps:
	cd $(MAIN_SERVER) && docker compose -f docker-compose.dev.yml ps

# ── 의존성 설치 ──────────────────────────────────────────────────────────────
.PHONY: install
install: install-api install-analyzer

.PHONY: install-api
install-api:
	$(PIP) install -r $(ADMIN_API_DIR)/requirements/dev.txt

.PHONY: install-analyzer
install-analyzer:
	$(PIP) install -r $(ANALYZER_DIR)/requirements/dev.txt

# ── 앱 실행 (hot-reload) ─────────────────────────────────────────────────────
.PHONY: run-api
run-api: _check-env
	@echo "→ admin-api 시작 (http://localhost:8080)"
	@echo "  Swagger UI: http://localhost:8080/docs"
	cd $(ADMIN_API_DIR) && set -a && source $(ENV_FILE) && set +a && \
		$(UVICORN) main:app --host 0.0.0.0 --port 8080 --reload

.PHONY: run-analyzer
run-analyzer: _check-env
	@echo "→ log-analyzer 시작 (http://localhost:8000)"
	cd $(ANALYZER_DIR) && set -a && source $(ENV_FILE) && set +a && \
		$(UVICORN) main:app --host 0.0.0.0 --port 8000 --reload

# ── 테스트 ───────────────────────────────────────────────────────────────────
.PHONY: test-api
test-api:
	cd $(ADMIN_API_DIR) && $(PYTHON) -m pytest -v

.PHONY: test-all
test-all: test-api

# ── 빌드 (운영 배포용 이미지) ────────────────────────────────────────────────
.PHONY: build
build: build-api build-analyzer

.PHONY: build-api
build-api:
	@echo "→ admin-api 이미지 빌드..."
	docker build -t aoms-admin-api:1.0 $(ADMIN_API_DIR)
	@echo "✓ aoms-admin-api:1.0 빌드 완료"

.PHONY: build-analyzer
build-analyzer:
	@echo "→ log-analyzer 이미지 빌드..."
	docker build -t aoms-log-analyzer:1.0 $(ANALYZER_DIR)
	@echo "✓ aoms-log-analyzer:1.0 빌드 완료"

# ── 편의 도구 ────────────────────────────────────────────────────────────────
.PHONY: db-shell
db-shell:
	docker exec -it dev-postgres psql -U aoms -d aoms

.PHONY: health
health:
	@echo "=== admin-api ===" && curl -s http://localhost:8080/health | python3 -m json.tool || echo "응답 없음"
	@echo "=== log-analyzer ===" && curl -s http://localhost:8000/health | python3 -m json.tool || echo "응답 없음"

# ── 테스트 데이터 주입 ───────────────────────────────────────────────────────
# 사용 순서:
#   1. make seed-db          → 테스트 시스템 + 담당자 생성 (1회)
#   2a. make test-metric     → 메트릭 알림 파이프라인
#   2b. make push-logs && make trigger-analysis  → 로그 분석 파이프라인
#   2c. make inject-analysis → 직접 분석 결과 주입 (LLM/Loki 우회)

SEED_SYSTEM_NAME := was-server
SEED_API         := http://localhost:8080
ANALYZER_API     := http://localhost:8000
LOKI_API         := http://localhost:3100

.PHONY: seed-db
seed-db:
	@echo "════════════════════════════════════════"
	@echo "  [SEED] 테스트 시스템 + 담당자 생성"
	@echo "════════════════════════════════════════"
	@echo "→ 시스템 등록: $(SEED_SYSTEM_NAME)"
	@SYSTEM_RESP=$$(curl -s -X POST $(SEED_API)/api/v1/systems \
	  -H "Content-Type: application/json" \
	  -d '{"system_name":"$(SEED_SYSTEM_NAME)","display_name":"테스트 WAS 서버","description":"Makefile seed 테스트용","host":"test-host","os_type":"linux","system_type":"was","status":"active"}'); \
	echo "  응답: $$SYSTEM_RESP"; \
	SYSTEM_ID=$$(echo "$$SYSTEM_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null); \
	if [ -z "$$SYSTEM_ID" ]; then \
	  echo "  → 이미 존재하는 시스템. 기존 ID 조회..."; \
	  SYSTEM_ID=$$(curl -s $(SEED_API)/api/v1/systems | python3 -c "import sys,json; systems=json.load(sys.stdin); match=[s for s in systems if s['system_name']=='$(SEED_SYSTEM_NAME)']; print(match[0]['id'] if match else '')"); \
	fi; \
	if [ -z "$$SYSTEM_ID" ]; then echo "✗ 시스템 등록 실패"; exit 1; fi; \
	echo "  system_id=$$SYSTEM_ID"; \
	echo "→ 담당자 등록: 테스트 담당자"; \
	CONTACT_RESP=$$(curl -s -X POST $(SEED_API)/api/v1/contacts \
	  -H "Content-Type: application/json" \
	  -d '{"name":"테스트 담당자","email":"test@example.com","teams_upn":"test@example.com"}'); \
	echo "  응답: $$CONTACT_RESP"; \
	CONTACT_ID=$$(echo "$$CONTACT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null); \
	if [ -z "$$CONTACT_ID" ]; then \
	  CONTACT_ID=$$(curl -s $(SEED_API)/api/v1/contacts | python3 -c "import sys,json; contacts=json.load(sys.stdin); match=[c for c in contacts if c['name']=='테스트 담당자']; print(match[0]['id'] if match else '')"); \
	fi; \
	if [ -z "$$CONTACT_ID" ]; then echo "✗ 담당자 등록 실패"; exit 1; fi; \
	echo "  contact_id=$$CONTACT_ID"; \
	echo "→ 시스템-담당자 연결"; \
	LINK_RESP=$$(curl -s -X POST $(SEED_API)/api/v1/systems/$$SYSTEM_ID/contacts \
	  -H "Content-Type: application/json" \
	  -d "{\"contact_id\":$$CONTACT_ID,\"role\":\"primary\",\"notify_channels\":\"teams\"}"); \
	echo "  응답: $$LINK_RESP"; \
	echo "✓ seed-db 완료 (system_id=$$SYSTEM_ID)"

.PHONY: test-metric
test-metric:
	@echo "════════════════════════════════════════"
	@echo "  [TEST] 메트릭 알림 파이프라인"
	@echo "  경로: admin-api /alerts/receive"
	@echo "        → 쿨다운 체크 → Teams 발송"
	@echo "        → /metric/similarity (log-analyzer)"
	@echo "════════════════════════════════════════"
	@curl -s -X POST $(SEED_API)/api/v1/alerts/receive \
	  -H "Content-Type: application/json" \
	  -d '{"version":"4","status":"firing","alerts":[{"status":"firing","labels":{"alertname":"HighMemoryUsage","system_name":"$(SEED_SYSTEM_NAME)","instance_role":"was1","severity":"warning","host":"test-host"},"annotations":{"summary":"메모리 사용률 85% 초과 (테스트)","description":"Makefile test-metric 테스트 알림"},"startsAt":"2024-01-01T00:00:00Z","endsAt":"0001-01-01T00:00:00Z"}]}' \
	  | python3 -m json.tool
	@echo ""
	@echo "→ 알림 이력 확인: curl -s $(SEED_API)/api/v1/alerts?limit=3 | python3 -m json.tool"

.PHONY: reset-cooldown
reset-cooldown:
	@echo "→ 쿨다운 초기화 ($(SEED_SYSTEM_NAME))"
	@docker exec dev-postgres psql -U aoms -d aoms \
	  -c "DELETE FROM alert_cooldown WHERE alert_key LIKE '$(SEED_SYSTEM_NAME):%';"
	@echo "✓ 완료"

.PHONY: push-logs
push-logs:
	@echo "════════════════════════════════════════"
	@echo "  [TEST] Loki 가짜 ERROR 로그 주입"
	@echo "  경로: Loki /loki/api/v1/push"
	@echo "════════════════════════════════════════"
	@TS=$$(python3 -c "import time; print(int(time.time()) * 1_000_000_000)"); \
	echo "→ 타임스탬프(ns): $$TS"; \
	HTTP_CODE=$$(curl -s -o /dev/null -w "%{http_code}" -X POST $(LOKI_API)/loki/api/v1/push \
	  -H "Content-Type: application/json" \
	  -d "{\"streams\":[{\"stream\":{\"system_name\":\"$(SEED_SYSTEM_NAME)\",\"instance_role\":\"was1\",\"host\":\"test-host\",\"log_type\":\"app\",\"level\":\"ERROR\"},\"values\":[[\"$$TS\",\"ERROR: OutOfMemoryError at heap space\\nException in thread \\\"main\\\" java.lang.OutOfMemoryError: Java heap space\"],[\"$$TS\",\"ERROR: Database connection pool exhausted after 30s timeout\"],[\"$$TS\",\"FATAL: Uncaught exception in request handler - NullPointerException at UserService.java:142\"]]}]}"); \
	if [ "$$HTTP_CODE" = "204" ]; then \
	  echo "✓ push-logs 완료 — 로그 3건 주입 (HTTP 204)"; \
	else \
	  echo "✗ push-logs 실패 (HTTP $$HTTP_CODE) — Loki가 실행 중인지 확인: make dev-up"; \
	fi
	@echo "→ trigger-analysis 로 분석 트리거: make trigger-analysis"

.PHONY: trigger-analysis
trigger-analysis:
	@echo "════════════════════════════════════════"
	@echo "  [TEST] 로그 분석 트리거 (비동기)"
	@echo "  경로: log-analyzer /analyze/trigger"
	@echo "        → Loki 최근 5분 조회 → LLM 분석"
	@echo "        → admin-api /api/v1/analysis"
	@echo "════════════════════════════════════════"
	@curl -s -X POST $(ANALYZER_API)/analyze/trigger | python3 -m json.tool
	@echo ""
	@echo "→ 진행 상태: curl -s $(ANALYZER_API)/analyze/status | python3 -m json.tool"
	@echo "→ 분석 결과: curl -s $(SEED_API)/api/v1/analysis?limit=3 | python3 -m json.tool"
	@echo "※ LLM_API_URL 미설정 시 LLM 단계에서 실패 — inject-analysis 로 우회 가능"

.PHONY: inject-analysis
inject-analysis:
	@echo "════════════════════════════════════════"
	@echo "  [TEST] 직접 분석 결과 주입 (LLM/Loki 우회)"
	@echo "  경로: admin-api /api/v1/analysis"
	@echo "        → Teams Adaptive Card 발송"
	@echo "════════════════════════════════════════"
	@SYSTEM_ID=$$(curl -s $(SEED_API)/api/v1/systems \
	  | python3 -c "import sys,json; systems=json.load(sys.stdin); match=[s for s in systems if s['system_name']=='$(SEED_SYSTEM_NAME)']; print(match[0]['id'] if match else '')"); \
	if [ -z "$$SYSTEM_ID" ]; then \
	  echo "✗ system_name=$(SEED_SYSTEM_NAME) 를 DB에서 찾을 수 없습니다."; \
	  echo "  먼저 실행하세요: make seed-db"; \
	  exit 1; \
	fi; \
	echo "→ system_id=$$SYSTEM_ID 로 분석 결과 주입 (severity=critical)"; \
	curl -s -X POST $(SEED_API)/api/v1/analysis \
	  -H "Content-Type: application/json" \
	  -d "{\"system_id\":$$SYSTEM_ID,\"instance_role\":\"was1\",\"log_content\":\"ERROR: OutOfMemoryError at heap space\\nException in thread main java.lang.OutOfMemoryError\",\"analysis_result\":\"JVM 힙 공간 고갈로 인한 OutOfMemoryError 발생\",\"severity\":\"critical\",\"root_cause\":\"JVM 힙 공간 고갈 (Java heap space)\",\"recommendation\":\"JVM 옵션 -Xmx 값 증가 및 메모리 누수 프로파일링 실시\",\"model_used\":\"makefile-test\",\"anomaly_type\":\"new\",\"similarity_score\":0.0,\"has_solution\":false}" \
	  | python3 -m json.tool
	@echo ""
	@echo "✓ inject-analysis 완료"
	@echo "→ 결과 확인: curl -s $(SEED_API)/api/v1/analysis?limit=3 | python3 -m json.tool"

# 합성 타겟
.PHONY: test-metric-alert
test-metric-alert: seed-db test-metric

.PHONY: test-log-pipeline
test-log-pipeline: seed-db push-logs trigger-analysis

.PHONY: test-inject
test-inject: seed-db inject-analysis

.PHONY: test-all-inject
test-all-inject: seed-db test-metric push-logs trigger-analysis inject-analysis
	@echo ""
	@echo "════════════════════════════════════════"
	@echo "✓ 전체 테스트 데이터 주입 완료"
	@echo "════════════════════════════════════════"

# ── 내부 헬퍼 ────────────────────────────────────────────────────────────────
.PHONY: _check-env
_check-env:
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "⚠ .env.local 파일이 없습니다. 먼저 실행하세요:"; \
		echo "   make env-setup"; \
		exit 1; \
	fi
