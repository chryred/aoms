# n8n-workflows (보류)

이 디렉터리는 **향후 log-analyzer로 이관 예정**인 워크플로우만 보관합니다.
현재 모두 `active: false` 상태이며 실제 실행되지 않습니다.

| 파일 | 트리거 | 역할 |
|---|---|---|
| `WF4-daily-report.json` | 매일 08:00 | 일일 장애 리포트 (LLM 요약 → Teams) |
| `WF5-escalation.json`   | 30분 주기 | 2시간+ 미처리 Critical 에스컬레이션 |

기타 WF1~WF3, WF6~WF12는 다음과 같이 대체되어 제거되었습니다.

- WF1, WF6~WF11 → log-analyzer 내부 스케줄러 (`_scheduler`, `_hourly_agg_scheduler` 등)
- WF2 → admin-api `routes/alerts.py`가 log-analyzer `/metric/similarity` 직접 호출
- WF3 → frontend `/feedback/submit` 페이지 + admin-api `POST /api/v1/feedback` 직결
- WF12 → log-analyzer `POST /aggregation/collections/setup` 직접 호출

자세한 이관 결정 배경은 `.claude/memory/adrs.md` (ADR-006) 참조.

## n8n 컨테이너 상태

`main-server/docker-compose.yml`의 n8n 서비스 블록은 **유지**되어 있습니다.
WF4/WF5를 포팅하기 전까지는 컨테이너만 띄워두고 워크플로우는 import하지 않습니다.

`CLAUDE.md`에는 향후 WF4/WF5 import 시 참고할 n8n 1.44 버전 호환성 노트를
보존해 두었습니다.
