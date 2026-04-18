-- OTel / Tempo 통합 (Phase OTel)
-- log_analysis_history: trace 상관 컬럼 추가
-- alert_history: 메트릭 알림 ↔ trace 링크 컬럼 추가

ALTER TABLE log_analysis_history
    ADD COLUMN IF NOT EXISTS referenced_trace_ids JSONB,       -- ["a1b2c3d4…", ...] 최대 5개 (NULL = OTel 미적용)
    ADD COLUMN IF NOT EXISTS trace_summary_text TEXT;          -- 프롬프트 주입 원문 (감사·디버그용, NULL = OTel 미적용)

ALTER TABLE alert_history
    ADD COLUMN IF NOT EXISTS related_trace_ids JSONB;          -- Alertmanager 수신 시점 ±60s 에러 trace top 3 (NULL = OTel 미적용)

COMMENT ON COLUMN log_analysis_history.referenced_trace_ids IS 'OTel trace IDs referenced in LLM analysis (NULL when OTel not applied)';
COMMENT ON COLUMN log_analysis_history.trace_summary_text IS 'Trace context text injected into LLM prompt (NULL when OTel not applied)';
COMMENT ON COLUMN alert_history.related_trace_ids IS 'Error trace IDs at alert time ±60s (NULL when OTel not applied)';
