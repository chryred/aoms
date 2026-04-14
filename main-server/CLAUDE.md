# main-server — 개발 주의사항 (CLAUDE.md)

각 서비스별 상세 가이드는 해당 디렉터리의 `CLAUDE.md`를 참고하세요.
전체 아키텍처·ADR·데이터 흐름 등 상세 컨텍스트는 **`.claude/memory/`** 에 분리 보관되어 있습니다(필요 시 Read tool로 로드).

---

## 환경변수 주입 구조

`.env.local` → `docker-compose.dev.yml`에서 `${VAR}` 방식으로 컨테이너에 주입됩니다.

```
.env.local
  └──(docker compose up)──▶ dev-n8n, dev-prometheus, dev-alertmanager 컨테이너
```

> `.env.local` 수정 후에는 반드시 해당 컨테이너를 재시작해야 새 값이 반영됩니다.

```bash
# 예: TEAMS_WEBHOOK_URL 변경 후
cd main-server
docker compose -f docker-compose.dev.yml up -d n8n
```

### 환경변수별 담당 서비스

| 변수 | 사용 서비스 | 비고 |
|---|---|---|
| `DATABASE_URL` | admin-api, log-analyzer | asyncpg URL |
| `TEAMS_WEBHOOK_URL` | admin-api | 전역 Teams webhook |
| `FRONTEND_EXTERNAL_URL` | admin-api | Teams 카드 "해결책 등록" 버튼이 여는 React 페이지 URL (브라우저 접근 가능해야 함, 예: `http://{server-a-ip}:3001`) |
| `LOG_ANALYZER_URL` | admin-api | 메트릭 유사도 분석 호출 |
| `LLM_API_URL` / `LLM_API_KEY` | log-analyzer | LLM 호출 |
| `OLLAMA_URL` / `EMBED_MODEL` | log-analyzer | 임베딩. 모델: `paraphrase-multilingual` (768dim, ADR-003) |
| `QDRANT_URL` | log-analyzer | 벡터 DB. 컬렉션 차원 768 (ADR-003) |
| `LLM_TYPE` | admin-api, log-analyzer | `devx`/`ollama`/`claude`/`openai` — `llm_client.py` Strategy가 라우팅 (ADR-001) |

---

## 로컬 개발 시작 순서

```bash
make dev-up          # 인프라 컨테이너 시작
make run-api         # admin-api 핫리로드 (8080)
make run-analyzer    # log-analyzer 핫리로드 (8000)
make test-api        # 단위 테스트 (인프라 불필요)
```

---

## 단위 테스트 작성 규칙

- 테스트 DB: SQLite in-memory (PostgreSQL 불필요)
- 외부 HTTP(Teams, log-analyzer): `unittest.mock.AsyncMock`으로 패치
- **`resolved` 알림은 처리됨** — `status == "resolved"` 반환 검증 (건너뛰는 게 아님)
- 테스트 파일 위치: `services/admin-api/tests/`

---

## Qdrant 컬렉션 구조

| 컬렉션 | 저장 주체 | 내용 |
|---|---|---|
| `metric_baselines` | log-analyzer | 메트릭 알림 이상 이력 (alert_history.qdrant_point_id) |
| `log_incidents` | log-analyzer | 로그 분석 이상 이력 (log_analysis_history.qdrant_point_id) |
| `metric_hourly_patterns` | log-analyzer (Phase 5) | `_hourly_agg_scheduler`가 저장하는 1시간 집계 LLM 분석 패턴 |
| `aggregation_summaries` | log-analyzer (Phase 5) | 일/주/월 집계 스케줄러가 저장하는 리포트 요약 |

피드백 등록 시 어느 컬렉션에 해결책을 업데이트할지 `alert_history.alert_type`으로 구분:
- `metric`, `metric_resolved` → `metric_baselines`
- 그 외 → `log_incidents`

`metric_hourly_patterns` / `aggregation_summaries`는 UI 유사도 검색 프록시(`/aggregation/search`, `/aggregation/similar-period`)가 활용한다.

컬렉션 초기화:
- `log_incidents` / `metric_baselines`: log-analyzer 부팅 시 자동 `ensure_collection` (ADR-004)
- `metric_hourly_patterns` / `aggregation_summaries`: `POST /aggregation/collections/setup` 수동 1회

**차원 불일치 주의**: 벡터 차원(`_VECTOR_SIZE`) 변경 시 기존 컬렉션 삭제 후 재생성 필요 (Qdrant는 생성 후 차원 변경 불가).

---

## 폐쇄망 Ollama 모델 배포

폐쇄망 서버에 Ollama 모델을 전송하는 스크립트 (repo root `scripts/`):

| 스크립트 | 용도 | 사용 예 |
|---|---|---|
| `scripts/export-ollama-model.sh` | MacBook 컨테이너에서 모델을 tar.gz로 추출 | `./scripts/export-ollama-model.sh dev-ollama paraphrase-multilingual ~/model.tar.gz` |
| `scripts/import-ollama-model.sh` | 폐쇄망 서버 Ollama 컨테이너에 import | `./import-ollama-model.sh prod-ollama /tmp/model.tar.gz` |

내부 동작:
1. `ollama show` manifest에서 참조 blob sha256 추출
2. manifest + 필요한 blob만 선별 tar.gz
3. 서버 Ollama `/root/.ollama/models/` 에 `tar -xzf`로 복원 (sha256 기반이라 충돌 없음)

기존 모델은 sha256이 달라 **덮어쓰기 없이 공존** — 롤백 대비용으로 일정 기간 보존 후 `ollama rm <old-model>` 권장.
