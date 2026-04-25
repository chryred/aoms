# synapse-cli — Claude 컨텍스트 가이드

운영 서버 담당자가 터미널에서 직접 LLM에 질의하는 Go CLI 도구.
admin-api Docker 이미지에 번들되어 SSH로 원격 서버에 배포된다.

## 명령어 구조

```
synapse login              # 최초 설정 — 서버 주소/계정/기본 시스템 등록
synapse ask "질문"          # 단방향 LLM 질의 (POST /api/v1/llm/query)
synapse ask --system oms "질문"   # 다른 시스템 컨텍스트로 질의
synapse ask --area infra "질문"   # 분석 영역(area_code) 지정
synapse ask --file app.log "분석해줘"  # 파일 내용 포함 (기본: 마지막 300줄)
synapse ask --file app.log --tail 500 "분석해줘"  # 마지막 N줄 지정
cat log.txt | synapse ask "분석해줘"  # stdin 파이프 지원
synapse chat               # 대화형 모드 — 세션 선택 또는 새 세션
synapse chat --new         # 새 세션 강제 시작
synapse chat --session <id>  # 특정 세션으로 진입
```

## 파일 구조

```
synapse-cli/
├── main.go          # 진입점 — 명령어 라우팅 (login/ask/chat)
├── auth/
│   └── auth.go      # Config 로드/저장, JWT 토큰 자동 갱신
└── cmd/
    ├── login.go     # synapse login 구현 — API 인증 후 config 저장
    ├── ask.go       # synapse ask 구현 — 단방향 LLM 질의 + stdin 파이프
    └── chat.go      # synapse chat 구현 — SSE 스트리밍 + 세션 관리
```

## Config 파일

- **경로**: 바이너리와 같은 디렉터리의 `.synapse_config.json`
  - `os.Executable()`로 바이너리 위치를 찾아 옆에 저장
  - Docker 환경에서 홈 디렉터리 UID 불일치 permission denied 방지가 이유
  - `SYNAPSE_CONFIG` 환경변수로 경로 오버라이드 가능 (최우선)
  - 폴백: `~/.synapse/config.json`
- **포함 필드**: `base_url`, `access_token`, `refresh_token`, `expires_at`, `system_name`, `last_session_id`

## 인증 흐름

1. `synapse login` → `POST {base_url}/api/v1/auth/login` → AccessToken(15분) + RefreshToken(7일) 저장
2. 매 명령 실행 시 `GetValidToken()` 호출:
   - `expires_at - 60초` 이내면 → `POST /api/v1/auth/refresh` 자동 갱신
   - Refresh 실패 시 기존 토큰 반환 (서버가 최종 판단)

## 핵심 API 연결

| 명령어 | 엔드포인트 | 비고 |
|---|---|---|
| `login` | `POST /api/v1/auth/login` | `X-Client: cli` 헤더 필수 |
| `ask` | `POST /api/v1/llm/query` | body: `{prompt, system_name, area_code}` |
| `chat` 세션 목록 | `GET /api/v1/chat/sessions` | 최근 10개 |
| `chat` 세션 생성 | `POST /api/v1/chat/sessions` | |
| `chat` 메시지 | `POST /api/v1/chat/sessions/{id}/messages` | SSE 스트리밍 (`Accept: text/event-stream`) |

### chat SSE 이벤트 타입
`thought` / `tool_call` / `token` / `final` / `error`
- `token`: 실시간 스트리밍 청크 (화면 출력)
- `final`: 토큰 스트림 없을 때 완성 텍스트 (DevX 폴백)

## 빌드 및 배포

### Docker 이미지 번들 (admin-api Dockerfile)
```dockerfile
FROM golang:1.23-alpine AS cli-builder
WORKDIR /build
COPY synapse-cli/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o synapse .

# 최종 이미지에 복사
COPY --from=cli-builder /build/synapse /app/bin/synapse
```

### 로컬 빌드
```bash
make build-api   # admin-api + synapse CLI Docker 이미지 빌드
```

### 서버 배포 흐름
admin-api의 CLI 배포 관리(`/api/v1/agents` — `agent_type=cli`) 기능이 SSH/SCP로 배포:
1. `/app/bin/synapse` (Docker 이미지 내) → 원격 서버 `~/bin/synapse` SCP
2. 배포 후 `synapse login` 실행 → config 파일 `~/bin/.synapse_config.json` 생성

## 개발 주의사항

### config 경로 변경 이력
- 초기: `~/.synapse/config.json` (홈 디렉터리)
- 현재: 바이너리 옆 `.synapse_config.json`
- **이유**: Docker 컨테이너 내 UID 불일치로 홈 디렉터리 쓰기 실패 (`permission denied`)

### area_code
`ask` 명령의 `--area` 옵션 값 = admin-api `llm_agent_configs` 테이블의 `area_code`.
기본값 `cli_query`가 테이블에 등록되어 있어야 LLM 호출이 성공한다.

### 타임아웃
- `ask`: 60초 (LLM 응답 대기)
- `chat` 메시지: 120초 (ReAct 루프 + 스트리밍)
- 그 외 API: 10초
