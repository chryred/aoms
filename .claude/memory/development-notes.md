# 개발 시 주의사항

## `system_name` 일관성
Prometheus label의 `system_name`과 PostgreSQL `systems.system_name`이 반드시 일치해야 한다. 불일치 시 알림은 수신되지만 담당자 조회 실패 → Teams 알림 미발송.

## `instance_role` 의미 — HA 이중화 식별자
`instance_role`은 에이전트 타입(infra/was)이 아닌 **이중화 인스턴스를 식별**하는 값이다.

```
system_name = "customer_experience"   ← DB systems.system_name
instance_role = "was1"                 ← HA 이중화 구분 (was1/was2, db-primary/db-standby)
host = "10.0.1.5"                      ← 물리 서버 IP
```

- 같은 서버의 동일 서비스 이중화: `was1`, `was2`
- DB HA: `db-primary`, `db-standby`
- 단일 인스턴스: `main` 또는 그냥 비워두면 기본값 `default`

## 다중 로그 소스 — `[[log_monitor]]` 배열
한 에이전트에서 여러 로그 파일을 각기 다른 `log_type` 라벨로 수집할 때 `[[log_monitor]]` 섹션을 여러 개 정의한다.

```toml
[[log_monitor]]
paths = ["/home/jeus/logs/JeusServer.log"]
keywords = ["ERROR", "Fatal", "Exception"]
log_type = "jeus"

[[log_monitor]]
paths = ["/opt/app/logs/*.log"]
keywords = ["ERROR", "CRITICAL"]
log_type = "app"
```

**담당자/채널 분리**가 필요한 경우 (서비스별 Teams webhook, 별도 LLM 비용):
→ 서비스마다 별도 `system_name`을 DB에 등록하고 에이전트 인스턴스도 분리.

**같은 팀이 여러 로그 파일 수집**만 필요한 경우:
→ 하나의 에이전트에 `[[log_monitor]]` 다중 정의.

## 담당자별 LLM API 키
`contacts.llm_api_key`가 있으면 해당 키로 LLM 호출, 없으면 환경변수 `LLM_API_KEY` 사용. AI 비용을 시스템 담당자별로 분리 청구하는 구조. `llm_client.call_llm_text(api_key, agent_code)`로 전달 (ADR-001).

## Teams Webhook URL 우선순위
`systems.teams_webhook_url` (시스템별) → `TEAMS_WEBHOOK_URL` 환경변수 (전역). 시스템별 알림 채널 분리 가능.

## 로그 수집 에이전트 — synapse_agent (Rust)
Phase 6에서 도입된 **synapse_agent 단일 바이너리** 수집기.
로그는 Loki로 push하지 않고 `log_error_total` Prometheus 메트릭으로 Remote Write한다.

- **설치**: admin-api `/api/v1/agents/install` → config.toml SFTP 업로드 → nohup 실행
- **설정 파일**: `config.toml` (`[[log_monitor]]` 다중 섹션으로 여러 로그 소스 지정)
- **WAL**: `/var/lib/synapse-agent/wal` (2시간 버퍼)
- **라벨**: `system_name`, `instance_role`, `host`, `log_type`, `level`, `service_name`, `template`
- **필터링**: `[[log_monitor]].keywords` 기반 AhoCorasick 매칭 → PII 마스킹 → `log_error_total` 메트릭

## 폐쇄망 배포
- Docker 이미지: Mac에서 `build-images.sh`로 `linux/amd64` 빌드 → `.tar.gz` 저장 → scp 전송 → `docker load`
- synapse_agent 바이너리: `cargo build --release --target x86_64-unknown-linux-musl` → scp 전송
- Python 패키지: `requirements/` 디렉토리에 버전 고정. 운영 Dockerfile은 `prod.txt`만 설치.
- **Ollama 모델**: `scripts/export-ollama-model.sh` + `scripts/import-ollama-model.sh` (ADR-003). sha256 기반 blob 복원으로 기존 모델과 공존, 덮어쓰기 없음.

## 로컬 개발
```bash
make dev-up          # 인프라 시작
make run-api         # admin-api 핫리로드 (포트 8080)
make run-analyzer    # log-analyzer 핫리로드 (포트 8000)
make test-api        # 단위 테스트 (인프라 불필요 — SQLite in-memory)
```

## LLM 호출 장애 대응 패턴 (ADR-001/002/003)
- DB `log_analysis_history.error_message` 컬럼으로 실패 사유 추적
- `model_used` 컬럼으로 사용된 프로바이더(`devx`/`ollama`/...) 자동 기록
- 임베딩 cold-start는 keep_alive="24h" + timeout=120s 로 방어 (vector_client.py)
- `_parse_json_from_text`는 3단계 fallback (code-fence → bare → brace-depth) + 응답 snippet 포함 에러 메시지
