# Agent-T SSE 이벤트 계약

gateway -> 브라우저 실시간 스트림. 한 화면 = 연결 1개.

`GET /t/v1/stream?system_ids=1,2`
- 헤더 `Authorization: Bearer <user JWT>` — admin-api 와 동일 `SECRET_KEY`, HS256, 클레임 `type == "access"`.
- 시각은 ms epoch(UTC). `uri`, `sql` 은 사전으로 해석된 문자열(ID 아님).

## 이벤트

### `event: active` (수신 즉시, 약 1초)
```
{system_id, instance_role, ts, slow_ms, buckets:[n,w,c],
 top:[{trace_id, span_id, thread, uri, start_ts, elapsed_ms, phase, sql, stack}]}
```

### `event: points` (산점도 완료 점)
```
{system_id, instance_role, points:[{ts, elapsed_ms, error, trace_id, span_id}]}
```
인스턴스당 초당 최대 200점. 느린 점·에러 점 우선 포함, 정상 점만 균등 샘플.

### `event: agg` (5초)
```
{system_id, instance_role, ts, tps, avg_ms, err_rate, slow_cnt,
 uri_top:[{uri,cnt,ms}], sql_top:[{sql,cnt,ms}],
 jvm:{...}|null, dropped:{detail,sql,tx}}
```
`jvm` 은 배치의 JVM 지표 구조를 따르며 해당 구간에 없으면 `null`.

### `event: ping` (15초)
```
{}
```

## 스냅샷 (SSE 실패 시 polling 폴백 겸 초기 로드)

`GET /t/v1/snapshot?system_ids=1,2` (동일 인증)
```
{"instances":[{system_id, instance_role, last_seen, active, agg:[최근 120개 agg]}]}
```
`active` 는 최신 `active` 이벤트 페이로드, `agg` 는 오래된 순 최대 120개(약 10분).
