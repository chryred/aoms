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
	@echo "  테스트"
	@echo "    make test-api       admin-api 단위 테스트"
	@echo "    make test-all       전체 테스트"
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

# ── 내부 헬퍼 ────────────────────────────────────────────────────────────────
.PHONY: _check-env
_check-env:
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "⚠ .env.local 파일이 없습니다. 먼저 실행하세요:"; \
		echo "   make env-setup"; \
		exit 1; \
	fi
