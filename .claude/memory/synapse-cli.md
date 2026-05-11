# Synapse CLI

운영 서버 담당자가 터미널에서 직접 LLM에 질의하는 Go CLI 도구.
admin-api Docker 이미지에 번들되어 SSH/SCP로 원격 서버에 배포된다.

## 디렉터리 구조

```
synapse-cli/
├── main.go          # 진입점 — login/ask/chat 명령 라우팅
├── auth/
│   └── auth.go      # Config 로드/저장, JWT 토큰 자동 갱신
└── cmd/
    ├── login.go     # synapse login — 서버 인증 후 config 저장
    ├── ask.go       # synapse ask — 단방향 LLM 질의 + stdin 파이프
    └── chat.go      # synapse chat — SSE 스트리밍 대화형 모드
```

## Config 파일 위치 결정 (중요)

**경로**: 바이너리와 같은 디렉터리의 `.synapse_config.json`

```go
// auth/auth.go configPath() 우선순위
// 1. SYNAPSE_CONFIG 환경변수
// 2. os.Executable() 기준 바이너리 옆
// 3. ~/.synapse/config.json (폴백)
```

**홈 디렉터리에 두지 않는 이유**: Docker 컨테이너 내 실행 시 호스트와 UID 불일치 → `permission denied`.
`os.UserHomeDir()` 반환값(`/home/jeussic`)의 소유 UID와 컨테이너 프로세스 UID가 달라 쓰기 실패.

현재 배포 방식(`~/bin/synapse`)에서는 config가 `~/bin/.synapse_config.json`에 생성된다.

## 명령어 → API 연결

| 명령 | 엔드포인트 | 비고 |
|---|---|---|
| `login` | `POST /api/v1/auth/login` | `X-Client: cli` 헤더 필수 |
| `ask` | `POST /api/v1/llm/query` | body: `{prompt, system_name, area_code}` |
| `chat` 목록 | `GET /api/v1/chat/sessions` | 최근 10개 |
| `chat` 생성 | `POST /api/v1/chat/sessions` | |
| `chat` 메시지 | `POST /api/v1/chat/sessions/{id}/messages` | SSE (`Accept: text/event-stream`) |

### chat SSE 이벤트
`thought` / `tool_call` / `token`(스트리밍 청크) / `final`(DevX 폴백) / `error`

## 빌드 및 배포

### Docker 이미지 번들
`main-server/services/admin-api/Dockerfile`에 Go 멀티스테이지 빌드 포함:
```dockerfile
FROM golang:1.23-alpine AS cli-builder
COPY synapse-cli/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o synapse .
# → /app/bin/synapse 로 복사
```

```bash
make build-api   # admin-api + synapse CLI 이미지 빌드
```

### 서버 배포 흐름
admin-api `routes/agents.py` CLI 배포 엔드포인트가 SSH/SCP로 처리:
1. Docker 이미지 내 `/app/bin/synapse` → 원격 서버 `~/bin/synapse` 복사
2. 재배포 시 바이너리만 덮어쓰고 `.synapse_config.json` (config)은 유지됨

## 주의사항

### area_code
`synapse ask --area <code>` 값 = admin-api `llm_agent_configs.area_code`.
기본값 `cli_query`가 DB에 등록되어 있어야 LLM 호출 성공. `/admin/llm-config`에서 관리.

### 토큰 갱신
Access Token 만료 60초 전에 자동으로 `POST /api/v1/auth/refresh` 호출.
Refresh 실패 시 기존 토큰 반환 → 서버가 최종 판단 (401 반환 시 `synapse login` 재실행).

### 타임아웃
- `ask`: 60초 / `chat` 메시지: 120초 / 그 외: 10초
