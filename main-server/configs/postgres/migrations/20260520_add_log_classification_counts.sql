-- 로그 알림성/실에러 분리 분류 스키마 마이그레이션
-- 실행 방법: psql 트랜잭션 밖 단독 실행 필요 (CONCURRENTLY 인덱스 포함)

-- alert_exclusions: 운영 데이터 없으므로 완전 삭제
DROP TABLE IF EXISTS alert_exclusions CASCADE;

-- log_analysis_history: 실에러/알림성 건수 + per-template 분류 컬럼 추가
ALTER TABLE log_analysis_history
    ADD COLUMN IF NOT EXISTS real_error_count             INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS notification_count           INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS template_classifications_json TEXT;

-- metric_hourly_aggregations: log 그룹 1시간 집계에 분리 건수 컬럼 추가
ALTER TABLE metric_hourly_aggregations
    ADD COLUMN IF NOT EXISTS real_error_count   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS notification_count INTEGER NOT NULL DEFAULT 0;

-- (system_id, created_at) 복합 인덱스: DB 전환 후 시간 범위 쿼리 성능 보장
-- prometheus_analyzer: created_at >= cutoff GROUP BY system_id
-- hourly 집계: system_id = X AND created_at BETWEEN ...
-- 4시간 트렌드: system_id = X AND created_at >= from_dt
-- /analysis/real-error-series: system_id = X AND created_at >= cutoff
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_log_analysis_history_system_created
    ON log_analysis_history (system_id, created_at);
