# Teams 알림을 워크플로 웹훅으로 옮기기

Microsoft가 Teams의 **Incoming Webhook 커넥터**를 은퇴시키면서 기존 알림 경로가 끊겼다.
대체 경로인 **워크플로(Power Automate)** 웹훅으로 다시 연결하는 절차다.
Teams 채널 하나당 약 10분, **코드 변경은 없다.**

```
기존   Synapse-V → *.webhook.office.com → 커넥터  → 채널   (은퇴)
신규   Synapse-V → *.logic.azure.com    → 워크플로 → 채널
```

---

## 코드는 이미 준비되어 있다

Synapse-V가 보내는 페이로드는 처음부터 `{"type":"message","attachments":[…]}` 봉투에 담긴
Adaptive Card v1.4 형식이다. 이는 워크플로 웹훅이 그대로 받는 형식이며, 전송부도
`202 Accepted`를 성공으로 판정하도록 이미 되어 있다.

| 확인 지점 | 위치 | 상태 |
|---|---|---|
| 카드 봉투 (`type: message` + `attachments[].contentType`) | `main-server/services/admin-api/services/adaptive_card_builder.py` | 호환 |
| Adaptive Card `version: "1.4"` | 위 파일 + `log-analyzer/aggregation_processor.py` | 호환 |
| 성공 판정 2xx 전체 (202 포함) | `admin-api/services/notification.py` `_post_webhook()` | 호환 |
| 집계 리포트 발송 `raise_for_status()` | `log-analyzer/aggregation_processor.py` `_send_teams()` | 호환 |

따라서 **바꿀 것은 URL 하나뿐이다.** 페이로드 형식을 고치거나 재배포할 필요가 없다.

---

## 시작 전 준비

| 항목 | 내용 |
|---|---|
| Teams 권한 | 알림을 받을 팀의 멤버. 팀 정책에 따라 소유자 승인이 필요할 수 있다. |
| 생성 계정 | 개인 계정 대신 **공용 운영 계정**으로 만들 것. 워크플로는 만든 사람의 계정에 묶이며, 그 계정이 비활성화되면 알림이 함께 멈춘다. |
| 방화벽 | 폐쇄망이므로 Server A에서 새 도메인으로 나가는 길을 먼저 열어야 한다 (1단계). |
| 채널 개수 | Teams 채널마다 워크플로를 하나씩 만든다. 시스템별로 다른 채널을 쓴다면 채널 수만큼 반복. |

---

## 1단계 — 방화벽 아웃바운드 개방 신청

**담당: 인프라 / 보안**

새 웹훅은 `*.logic.azure.com` 을 쓴다. 기존에 `*.webhook.office.com` 만 허용돼 있다면
이 단계 없이는 뒤 단계가 모두 무의미하므로 **가장 먼저 신청**한다.

| 항목 | 값 |
|---|---|
| 출발지 | Server A `10.253.21.106` (admin-api, log-analyzer 컨테이너) |
| 목적지 | `*.logic.azure.com` |
| 포트 | `443/TCP` (HTTPS) |
| 사유 | Teams 채널 알림 발송 (O365 커넥터 은퇴에 따른 대체 경로) |

개방 후 서버에서 TLS 핸드셰이크가 되는지 확인한다.

```bash
curl -sv --max-time 5 https://prod-00.koreacentral.logic.azure.com 2>&1 \
  | grep -iE "connected|SSL connection"
```

> **확인** — `Connected` 또는 `SSL connection` 줄이 출력되면 통과.
> 404 응답이 와도 정상이다 (길이 열린 것).

---

## 2단계 — Teams에서 워크플로 만들기

**담당: 운영 (Teams 화면)**

1. 알림을 받을 **채널 이름 위에 마우스를 올리고** 오른쪽 `⋯` → **워크플로** 클릭
   - 메뉴에 없으면 Teams 왼쪽 앱 바 `⋯` → **Workflows** 앱을 검색해 실행해도 된다.
2. 템플릿 목록에서 **웹후크 요청을 받으면 채널에 게시** 선택
   - 영문 환경: **Post to a channel when a webhook request is received**
3. 연결 계정을 확인하고 **다음**. 준비 단계에서 정한 공용 운영 계정인지 다시 본다.
4. **팀**과 **채널**을 선택하고 **워크플로 만들기**
5. 완료 화면에 **웹훅 URL**이 나온다. **복사** 버튼으로 전체를 복사해 안전한 곳에 붙여둔다.

URL 모양:

```
https://prod-NN.koreacentral.logic.azure.com:443/workflows/<id>/triggers/manual/paths/invoke
  ?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=<서명>
```

> **주의** — URL 끝의 `&sig=…` 가 이 웹훅의 인증 키 전부다. 일부만 복사하면 `401/403`이 나고,
> 원인 찾기가 가장 어려운 실수다. 화면을 닫기 전에 `?api-version=` 부터 끝까지 들어왔는지 눈으로 확인할 것.
> **URL 자체가 곧 비밀번호이므로 채팅·이슈·문서에 그대로 붙여넣지 않는다.**

---

## 3단계 — 워크플로 내부 설정 점검

**담당: 운영 (Power Automate 화면)**

템플릿 기본값이면 대개 그대로 동작하지만, **카드가 안 뜨는 사고의 1순위 원인**이 여기 있으므로 한 번 열어 확인한다.

1. `make.powerautomate.com` 접속 → 왼쪽 **내 흐름** → 방금 만든 흐름 → **편집**
2. 트리거 **HTTP 요청을 받는 경우** 를 열고, **다음이 흐름을 트리거할 수 있음** 이
   **누구나(Anyone)** 인지 확인. 이게 아니면 서버에서 호출해도 인증 오류가 난다.
3. 액션 **채팅 또는 채널에 카드 게시** 를 열고 **Adaptive Card** 입력란이 카드 본문을 가리키는지 확인:

```
@{triggerOutputs()?['body/attachments'][0]/content}
```

> **왜 이 식인가** — Synapse-V는 카드를 `attachments[0].content` 안에 담아 보낸다.
> 이 식이 어긋나 있으면 요청은 `202`로 성공하는데 채널에는 빈 메시지나 원시 JSON이 올라온다.

---

## 4단계 — 서버에서 발송 테스트

**담당: 운영 (Server A 터미널)**

Synapse-V에 등록하기 전에 실제 알림과 같은 형식으로 한 번 쏴본다.
내 PC가 아니라 **실제로 알림을 보내는 Server A에서** 실행해야 방화벽까지 함께 검증된다.

```bash
WEBHOOK='<복사한 URL 전체>'

curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$WEBHOOK" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "message",
    "attachments": [{
      "contentType": "application/vnd.microsoft.card.adaptive",
      "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
          {"type":"TextBlock","text":"Synapse-V 연결 테스트","weight":"Bolder","size":"Medium"},
          {"type":"FactSet","facts":[{"title":"상태","value":"웹훅 정상"}]}
        ]
      }
    }]
  }'
```

| 응답 | 의미 |
|---|---|
| `202` | 정상. 워크플로가 요청을 접수했다. 채널에 카드가 뜨는지 확인. |
| `401` `403` | URL의 `sig` 값이 잘렸거나 트리거 권한이 "누구나"가 아니다. |
| `400` | 페이로드 구조 오류. 위 JSON을 그대로 복사했는지 확인. |
| 타임아웃 · `000` | 방화벽이 열리지 않았다. 1단계로 돌아간다. |

> **알아둘 차이** — 구 커넥터는 `200`을 반환했지만 워크플로는 `202 Accepted`를 반환한다.
> "접수했다"는 뜻이라 **202가 와도 게시는 실패할 수 있다.**
> 반드시 채널을 눈으로 확인하고, 안 보이면 Power Automate의 **28일 실행 기록**에서 실패 사유를 본다.

---

## 5단계 — Synapse-V에 URL 등록

**담당: 운영**

등록 위치는 두 곳이고, **시스템별 설정이 전역 설정보다 우선**한다.

### A. 시스템별 (권장 · 재기동 불필요)

1. Synapse-V 화면 → **시스템** 메뉴 (`/systems`)
2. 해당 시스템의 **편집** → **Teams Webhook URL** 칸에 붙여넣기
3. **저장**. 즉시 반영되며 컨테이너 재기동이 필요 없다. (DB `systems.teams_webhook_url`)

시스템마다 다른 채널로 알림을 보내려면 이 방식만 쓴다.

### B. 전역 폴백 (시스템별 값이 없을 때 사용됨)

```bash
# main-server/.env
TEAMS_WEBHOOK_URL=https://prod-NN.koreacentral.logic.azure.com:443/workflows/...
```

```bash
cd main-server
docker compose up -d admin-api log-analyzer
```

> **재기동 필요** — 전역 값은 컨테이너 환경변수로 주입되므로 `.env` 수정만으로는 반영되지 않는다.
> 위 명령으로 **admin-api와 log-analyzer를 함께** 다시 올릴 것. 두 서비스 모두 Teams로 발송한다.

---

## 6단계 — 실제 알림으로 마무리 검증

**담당: 운영**

테스트 curl이 아니라 시스템이 스스로 보내는 알림이 도착하는지 확인한다. 발송 로그를 열어두고 기다린다.

```bash
docker logs -f --tail 100 admin-api    | grep -i teams
docker logs -f --tail 100 log-analyzer | grep -i teams
```

| 로그 | 판정 |
|---|---|
| 아무 경고 없음 | 정상 발송 |
| `Teams webhook responded 4xx` | URL 또는 워크플로 문제 — 2·3단계 재확인 |
| `Teams 비동기 발송 실패 (무시)` | 연결 실패 또는 타임아웃 — 방화벽·응답지연 확인 |
| `Teams Webhook URL 미설정 — 알림 생략` | 해당 시스템에도 전역에도 URL이 없음 — 5단계 재확인 |

---

## 전환 후 달라지는 것

| 항목 | 구 커넥터 | 워크플로 |
|---|---|---|
| 게시자 표시 | 커넥터 이름 | **Flow bot** 으로 표시된다. 채널 구성원에게 미리 알려둘 것. |
| 성공 응답 | `200` | `202 Accepted` (코드에서 이미 성공 처리) |
| 버튼 링크 | 정상 | 정상 — "인시던트 보기" 버튼은 그대로 동작 |
| @멘션 | 정상 | **검증 필요.** `build_entities()`가 넣는 `msteams.entities` 멘션이 Flow bot 게시에서 이름만 평문으로 보일 수 있다. 4단계 테스트에 멘션 포함 카드를 한 번 섞어 확인할 것. |
| 소유권 | 채널에 귀속 | 만든 사람 계정에 귀속. 인사이동 시 인계 대상. |
| 장기 유휴 | 없음 | Power Automate는 오래 실행되지 않은 흐름을 중지시킬 수 있다. 분기 1회 흐름 상태 점검 권장. |

---

## 증상별 조치

| 증상 | 원인 | 조치 |
|---|---|---|
| 연결 실패 · 타임아웃 | 방화벽 미개방 | `*.logic.azure.com:443` 개방 신청 (1단계) |
| `401` / `403` | `sig` 파라미터 누락, 트리거 권한 | URL 전체 재복사, 트리거를 "누구나"로 (2·3단계) |
| `202`인데 채널 무반응 | 흐름 실행 단계에서 실패 | Power Automate → 해당 흐름 → 실행 기록에서 실패 액션 확인 |
| 빈 메시지 · 원시 JSON | Adaptive Card 매핑 어긋남 | `attachments[0]/content` 식으로 수정 (3단계) |
| `400 Bad Request` | 봉투 구조 없이 카드만 전송 | Synapse-V 정상 경로에서는 발생하지 않음. 직접 만든 테스트 JSON 확인 |
| 일부만 오고 일부는 누락 | 발송 동시성 상한 또는 응답 지연 | `TEAMS_SEND_CONCURRENCY`(기본 5) 상향 검토, admin-api 로그에서 지연 확인. admin-api 발송 타임아웃은 1초(`notification.py`)로 짧다 |
| 어느 날 갑자기 전부 중단 | 생성 계정 비활성 또는 흐름 중지 | Power Automate에서 흐름 상태 확인 후 켜기. 공용 계정으로 재생성 권장 |

---

## 관련 코드 / 설정 위치

- 카드 봉투 빌더 — `main-server/services/admin-api/services/adaptive_card_builder.py`
- 웹훅 전송 — `main-server/services/admin-api/services/notification.py`
- 집계 리포트 발송 — `main-server/services/log-analyzer/aggregation_processor.py`
- 시스템별 URL — DB `systems.teams_webhook_url` (프론트 `/systems` → 시스템 편집)
- 전역 폴백 URL — `TEAMS_WEBHOOK_URL` (`main-server/docker-compose.yml` 3개 서비스에 주입)
