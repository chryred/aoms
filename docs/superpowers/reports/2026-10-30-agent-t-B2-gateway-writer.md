# Agent-T B2 보고서 (gateway ClickHouse 적재·사전·명령·agentsim) — 재작성본

> 원본 SDD 보고서(`.superpowers/sdd/.../task-B2-report.md`)가 worktree 정리 중 소실되어 대화 기록과 커밋 이력을 기준으로 다시 정리함.
> 구현은 `main` 의 `agent-t-gateway/` 에 병합됨 (merge `46174c3`).

## 1. 구현 범위
| 항목 | 파일 | 요약 |
|---|---|---|
| 행 변환 | `internal/store/rows.go` | `SummaryRow`/`SqlRows`/`DetailRow`/`DumpRow`. hex id → UInt64, 부호 없는 컬럼 clamp, trace/span 길이 불량 행은 건너뜀. 시각은 UTC 문자열(`YYYY-MM-DD hh:mm:ss.sss`), `expire_at` = 보정된 start_ts + 보관일 |
| ClickHouse 적재 | `internal/store/writer.go` | `Writer`(Sink + Backpressure). 테이블별 버퍼, 간격/행수/종료 시 flush, gzip JSONEachRow. 큐 상한 초과 시 상세→SQL→요약→사전 순 폐기(`DropStats`), 80% 이상이면 `BackoffMs=2000`. 덤프 행은 폐기하지 않음 |
| 사전 | `internal/store/dict.go` | LRU 200,000, 미적재로 시작 → `need_dict`. `dict_sql`/`dict_uri` 적재 |
| 명령 | `internal/store/commands.go` | PG `agent_commands` 2초 폴링, 전달 시 `sent`, 덤프 적재 후 `done`+`result_ref=cmd_id`. PG 접근은 `CommandStore` 인터페이스 뒤 |
| 부하 생성기 | `cmd/agentsim` | `agentsim -gateway URL -tokens file -jvms N -tps N -duration D` |
| B1 이월 | `handler.go`, `main.go`, `Dockerfile` | `BackoffMs()` 1회 캡처, `ReadTimeout 30s`/`IdleTimeout 120s`, distroless `:nonroot` |

## 2. 리뷰 1차 수정
1. flush 를 `FlushRows` 단위 청크로 분할, 일시 오류 시 미전송 잔여분만 순서 유지하며 재큐잉 (장애 후 백로그가 거대한 단일 INSERT 가 되어 영구 실패하던 문제)
2. 종료 순서: HTTP Shutdown → writer 최종 flush → 마지막 `Commands.Sync`
3. 큐 상한을 하드 상한으로: 상세/SQL/요약이 없으면 사전 행 폐기 (덤프는 유지)

## 3. 검증 사실
- 통합 테스트(`-tags integration`): 샘플 배치 적재 후 `tx_summary` 3행, `tx_detail` 1행, 덤프 1행, ms 정밀도·UTC·`expire_at`(+7일)·UInt64 id 왕복 확인
- 주의: `expire_at` 이 과거면 ClickHouse TTL 이 INSERT 즉시 행을 버림. 계약 샘플(2025년 시각)은 테스트에서 skew offset 으로 현재로 이동시켜 사용
- 단위: 만료일 계산, 폐기 순서, flush 행수, 청크 분할/부분 실패, 하드 상한, 덤프 ack, 사전 LRU, 명령 sent/done

## 4. D-H1-3 (ClickHouse 정지 시 인입 지연·실패) 결론
- 게이트웨이 인입 경로에서 ClickHouse/PG 를 동기 호출하는 지점은 없음. `Writer.mu` 는 I/O 중 잡지 않음
- 재현 시험(`internal/ingest/stall_test.go`): ClickHouse 무응답 중 p99 ≈ 20~50ms, 큐 80% 초과 후 429 + `BackoffMs=2000`
- E2E S10 은 메모리 부족 Docker VM(여유 67MB, swap 가득, 메모리 PSI full ≈ 10%)에서 PASS 1 / FAIL 4(실패 post 49~332) 로 불안정, 게이트웨이 CPU 는 user≈0·sys 높음
- `synq-opensearch` 를 내려 여유 메모리 확보 후 병합본으로 3회 재실행: 3/3 PASS (실패 post 0, 429 0, p99 4.9~18.8ms, max 63~128ms). 이후 H1 최종 실행도 PASS (p99 2.6ms, 적재 = 송신 241,080, 중복 span 0)
- 결론: 환경(VM 메모리 부족) 요인으로 판단. 메모리 부족 상태에서 같은 코드의 FAIL 재현은 하지 않아 "확정"이 아닌 "유력"
- 운영 권고: e2e 는 VM 메모리 6GB 이상 또는 무관 컨테이너 중지 후 실행. 큐 상한이 큰 값(256MB)이므로 메모리가 작은 환경에서는 `GATEWAY_CH_QUEUE_MAX_BYTES` 를 낮춰 429 가 먼저 걸리게 할 것

## 5. 알려진 한계
- 명령 전달은 at-most-once (응답에 싣는 순간 메모리에서 제거)
- `active.top` 은 저장하지 않음 (실시간 경로는 live 패키지)
