# main-server — 개발 주의사항 (CLAUDE.md)

각 서비스별 상세 가이드는 해당 디렉터리의 `CLAUDE.md`를 참고하세요.

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
| `TEAMS_WEBHOOK_URL` | admin-api, n8n | 전역 Teams webhook |
| `ADMIN_API_EXTERNAL_URL` | admin-api | Teams 카드 피드백 버튼 URL (브라우저 접근 가능해야 함) |
| `N8N_WEBHOOK_URL` | admin-api | 피드백 폼 제출 대상 |
| `LOG_ANALYZER_URL` | admin-api | 메트릭 유사도 분석 호출 |
| `LLM_API_URL` / `LLM_API_KEY` | log-analyzer | LLM 호출 |
| `OLLAMA_URL` / `EMBED_MODEL` | log-analyzer, n8n | 임베딩 |
| `QDRANT_URL` | log-analyzer, n8n | 벡터 DB |

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

피드백 등록 시 어느 컬렉션에 해결책을 업데이트할지 `alert_history.alert_type`으로 구분:
- `metric`, `metric_resolved` → `metric_baselines`
- 그 외 → `log_incidents`
