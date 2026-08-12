# UTC/KST 타임존 정책 (ADR-013)

시스템 전 레이어에서 UTC/KST 처리 기준. UTC/KST 혼재로 3가지 버그(API naive datetime ±9h 오류, 집계 버킷 9시간 어긋남, 배치 스케줄 불일치) 발생 후 ADR-013으로 통일.

## 레이어별 기준

| 레이어 | 기준 | 구현 위치 |
|---|---|---|
| DB 저장 | UTC naive (`TIMESTAMP WITHOUT TIME ZONE`) | 모든 테이블 |
| API 응답 datetime | UTC + `Z` suffix | `schemas.py` `UtcDatetime` Annotated 타입 |
| Frontend 표시 | KST | `src/lib/utils.ts` `formatKST()` |
| Frontend 기간 조회 | KST 입력 → UTC 변환 후 전송 | `kstDateToUtcStart/End()` |
| log-analyzer 배치 트리거 | KST (언제 실행할지) | `main.py` `_KST` 스케줄러 |
| log-analyzer 집계 버킷 | KST 경계 계산 → UTC naive로 DB 저장 | `aggregation_processor.py` `_KST` |
| Prometheus 데이터 | UTC (프로토콜 고정, 변경 불가) | Remote Write epoch |

## 핵심 규칙

- `datetime.utcnow()` 금지 → `datetime.now(timezone.utc).replace(tzinfo=None)` 사용
- `datetime.now()` (로컬 타임존 naive) 금지
- 수동 `+9h` 하드코딩 금지 — `formatKST()` / `_KST` 상수 경유
- `new Date(naiveUtcString)` 직접 호출 금지 → `normalizeUtc()` 경유
- 집계 버킷 계산 시 반드시 KST 경계 계산 후 UTC naive 변환
- **KST tz-aware datetime에 `aggregation_processor._dt_naive()` 사용 금지** — tzinfo만 떼기 때문에 KST 벽시계가 UTC로 저장되어 9시간 밀린다. 기간 경계는 `_utc_naive_iso()` 경유 (2026-08-12: 분기/반기/연간 리포트가 이 실수로 KST 자정을 UTC 자정으로 저장하고 있었음)

## Frontend 공통 유틸 (`src/lib/utils.ts`)
- `formatKST()` — UTC → KST 표시
- `formatRelative()` — 상대 시각
- `kstDateToUtcStart()` / `kstDateToUtcEnd()` — 날짜 피커 입력 → 백엔드 전송
