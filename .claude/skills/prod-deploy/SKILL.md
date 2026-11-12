---
name: prod-deploy
description: Synapse-V 운영기(Server A 10.253.21.106) 이미지 빌드·반입·교체·검증 절차와 과거 배포에서 겪은 이슈. "운영기 반영", "운영 배포", "prod 배포", "이미지 올려줘", "운영에서 확인", 롤백 요청 시 사용.
---

# 운영기 배포 (Synapse-V)

폐쇄망 Server A(`10.253.21.106`, compose 프로젝트 `/app/synapse`)에 Docker 이미지를 tar 로 반입해 교체하는 절차.
2.3 ~ 2.5 배포(2026-11)에서 실제로 쓴 순서 그대로다.

## 0. 시작 전 확인 (게이트)

- **사용자가 운영 반영을 명시적으로 지시했는가** — 커밋/push 지시와 운영 반영 지시는 별개다.
- 로컬 테스트 통과: `make test-api`, frontend `npm run lint && npx tsc --noEmit && npx vitest run`.
- 커밋·push 완료 상태에서 빌드한다(빌드 결과 `IMAGE_VERSION` + `main-server/docker-compose.yml` 을 함께 커밋).
- **DB 마이그레이션이 포함되면 운영 적용은 사용자 승인 후에만**. 적용 전 `pg_dump` 백업을 `/app/synapse/backup/pg_*_YYYYMMDD.*` 로 남긴다.
- ClickHouse 마이그레이션(`configs/clickhouse/migrations/`)이 있으면 **새 gateway·admin-api 반입 전에 먼저** 적용(`main-server/CLAUDE.md` 참고).
- 접속 비밀번호는 대화로 받은 값을 **명령행 환경변수 `SV_PW` 로만** 넘긴다. 리포 파일·보고서·로그·메모리에 절대 쓰지 않는다.

## 1. 빌드 (로컬)

```bash
./build-images.sh          # 인자 없이 = build. IMAGE_VERSION 자동 +0.1, compose 태그 갱신
```
- 4개 이미지(admin-api, log-analyzer, frontend, agent-t-gateway) + clickhouse 를 모두 빌드·저장한다(서비스 선택 불가). 수 분~십수 분 → `run_in_background` 로 돌리고 로그를 scratchpad 에 남긴다.
- 산출물: `main-server/synapse-<svc>-X.Y.tar.gz`
- 빌드 후 `IMAGE_VERSION`, `main-server/docker-compose.yml` 을 `build: 이미지 버전 X.Y` 로 커밋(사용자가 push 지시했을 때만 push).
- agent jar 해시 불일치로 중단되면 안내대로 `make build-agent-v` / `make build-agent-t` 후 재실행.

## 2. 접속 헬퍼

운영 SSH 는 **exec 채널을 거부**한다 → 일반 `ssh host cmd` / paramiko `exec_command` 불가. 이 스킬의 `scripts/r.py`(paramiko `invoke_shell` PTY + 종료 마커, SFTP put/get)를 쓴다.

```bash
# zsh 에서 함수로 정의 (변수 문자열 "$R ..." 은 zsh 가 word-split 하지 않아 실패한다)
r(){ SV_PW='<대화로 받은 비번>' SV_TO=900 /Users/company/workspaces/aoms/venv/bin/python \
     /Users/company/workspaces/aoms/.claude/skills/prod-deploy/scripts/r.py "$@"; }

r "docker ps --format '{{.Names}} {{.Image}} {{.Status}}'"
r put main-server/synapse-admin-api-2.5.tar.gz /app/synapse/aoms-offline/docker-images/synapse-admin-api-2.5.tar.gz.tmp
```
- env: `SV_HOST`(기본 10.253.21.106), `SV_USER`(기본 container), `SV_TO`(타임아웃 초, 기본 300).
- 헬퍼를 scratchpad/`/tmp` 에 두면 tmp 정리로 사라진다 → 반드시 이 스킬 경로의 것을 사용.
- 서버 셸에 색상 alias 가 있어 출력 파싱이 깨지면 명령 앞에 `unalias -a;`.

## 3. 반입 (바뀐 서비스만)

이미지 디렉터리: `/app/synapse/aoms-offline/docker-images/`

1. 디스크 확인: `df -h /app` — docker root(`/app/docker`)와 같은 100G 파티션. tar 1개 ~0.5~1GB, 로드 시 그 이상 필요. 여유 10G 미만이면 오래된 이미지/tar 정리 여부를 사용자에게 묻는다(직전 1~2개 버전은 롤백용으로 남김).
2. **`.tmp` 이름으로 업로드** → 업로드 중단 시 반쪽 파일이 정식 이름으로 남지 않게.
3. sha256 대조: 로컬 `shasum -a 256 <tar>` vs 서버 `sha256sum <tar>.tmp` 일치 확인 후 `mv` 로 정식 이름.
4. 로드: `gzip -d -c <tar> | docker load` (pigz 없을 수 있음). `docker images | grep synapse` 로 새 태그 확인.

## 4. 교체

```bash
cd /app/synapse
cp docker-compose.yml backup/docker-compose.yml_YYYYMMDD_X.Y
cp .env backup/.env_YYYYMMDD_X.Y          # .env 를 건드리는 배포일 때
sed -i -E 's|(image: synapse-admin-api:)[0-9.]+|\1X.Y|; s|(image: synapse-frontend:)[0-9.]+|\1X.Y|' docker-compose.yml
grep -n 'image: synapse-' docker-compose.yml
docker compose up -d --no-deps admin-api frontend
```
- **바뀐 서비스만** 태그 변경 + `--no-deps` 로 재기동. 다른 서비스는 의도적으로 이전 버전 유지가 정상이다(예: 2.5 시점 log-analyzer 2.1, gateway 2.2). 전체 `docker compose up -d` / `down` 금지.
- 로컬 `main-server/docker-compose.yml` 은 4개 모두 새 태그지만 운영 compose 는 서비스별 태그가 다르다 → **로컬 파일을 운영에 덮어쓰지 않는다**, sed 로 해당 줄만 바꾼다.
- 같은 서버의 `/app/jira`(sr_api, sr_streamlit)는 별도 프로젝트 — 건드리지 않는다.
- 개발 WAS 의 sic_server1 은 절대 직접 재시작하지 않는다.

## 5. 검증

서버 측:
- `docker ps` 새 태그로 `Up` / healthy
- `curl -s -o /dev/null -w '%{http_code}' localhost:8080/health` → 200
- frontend `localhost:3001` 200, `index.html` 응답 헤더 `Cache-Control: no-cache` (사용자 브라우저가 옛 번들을 안 잡는지)
- 새 코드가 컨테이너에 실제로 들어갔는지: `docker exec <c> grep -n '<새 함수/문자열>' <파일>` (frontend 는 번들 js 에서 새 문구 grep)
- `docker logs --since 5m <c> 2>&1 | grep -iE 'error|traceback'` 비어 있음

화면 측 (브라우저 도구 순서: **ego-browser → Chrome DevTools MCP → Playwright MCP**, 루트 CLAUDE.md 규칙):
- sonnet subagent 에 위임, 탭 1개만 쓰고 `finish({keep:[]})` 로 닫기, 사용자 공간/탭 건드리지 않기, TanStack devtools 열지 않기.
- 확인 항목·기대값을 표로 주고, 스크린샷은 scratchpad 에 저장, 실패는 원인 추정까지 받는다.
- 실패 → 로컬 수정·테스트 → 재빌드(버전 +0.1) → 3~5 반복. 한 번에 몰아서 고친다.

## 6. 롤백

```bash
cd /app/synapse
sed -i -E 's|(image: synapse-admin-api:)[0-9.]+|\1<이전>|; s|(image: synapse-frontend:)[0-9.]+|\1<이전>|' docker-compose.yml
docker compose up -d --no-deps admin-api frontend
```
또는 `backup/docker-compose.yml_YYYYMMDD_X.Y` 를 복원. 이전 버전 이미지·tar 가 서버에 남아 있어야 하므로 3단계에서 지우지 않는다.

## 7. 보고 (한글)

- 운영 현재 버전(서비스별), 검증 결과 표(항목/결과/화면에서 본 내용), 커밋 해시, 롤백 방법, 남은 이슈.
- 운영 계정에 만든 테스트 데이터(챗봇 대화 등)를 남겼으면 그 사실을 적는다.

## 알려진 이슈 / 함정

| 증상 | 원인·대응 |
|---|---|
| `ssh host cmd`, paramiko `exec_command` 가 바로 끊김 | 운영 sshd 가 exec 채널 거부. `scripts/r.py` 의 invoke_shell 방식 사용 |
| scratchpad 에 둔 헬퍼가 다음 날 사라짐 | macOS tmp 정리. 스킬 내 `scripts/r.py` 사용 |
| zsh 에서 `R="python r.py"; $R "cmd"` 실패 | zsh 는 미인용 변수 word-split 안 함 → 함수 `r(){ ... }` 로 정의 |
| admin-api RestartCount 가 100+ | 정상. Dockerfile `--limit-max-requests ${UVICORN_MAX_REQUESTS:-500}` 로 약 1시간마다 워커 재시작. 단 진행 중 챗봇 SSE 응답이 끊길 수 있음 |
| 로컬에서 챗봇 실제 LLM 응답 확인 불가 | DevX 가 로컬 IP 에 403. LLM 판단(범위 선택·답변 품질)은 운영 배포 후에만 검증 가능 → 로컬은 단위테스트·UI 까지, LLM 동작은 운영 QA 항목으로 분리 |
| ego-browser 로 콘솔 에러 수 측정 안 됨 | 콘솔 패널 기본 숨김. 필요하면 Chrome DevTools MCP 로 콘솔만 별도 확인하고 사유 기록 |
| `/app` 사용률 80%+ | docker root 공용 파티션. 반입 전 `df -h /app`, 오래된 tar/이미지 정리는 사용자 확인 후 |
| 빌드가 4개 이미지를 모두 만듦 | 정상. 반입·교체는 바뀐 서비스만 |
| 운영 compose 태그가 서비스마다 다름 | 의도된 상태. 로컬 compose 로 덮어쓰기 금지 |
| 단위 테스트는 통과했는데 운영 QA 실패(2.4: 인시던트 화면 범위 누락, 조회 라벨 오표시) | 화면 컨텍스트 등록·LLM 프롬프트 의존 동작은 테스트로 다 못 잡는다. 운영 QA 항목에 "화면별 동작"을 반드시 포함 |

## 금지

- 비밀번호·계정을 리포 파일/커밋/보고서/로그에 기록
- 승인 없는 운영 DB 마이그레이션, 전체 `compose down`, 다른 compose 프로젝트 조작
- 롤백용 이전 버전 이미지·tar 삭제(사용자 확인 없이)
- 사용자 지시 없는 push
