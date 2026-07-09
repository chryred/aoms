-- 2026-07-07 — severity='error' 오염 데이터 정규화
--
-- 배경: LLM이 프롬프트 열거형(info/warning/critical)을 벗어난 severity="error"를 반환했고
-- 검증 계층이 없어 log_analysis_history / alert_history / incidents에 그대로 저장됨.
-- "error"는 Teams 발송 조건(warning/critical)에서 빠지고 UI에 원문 노출됨.
-- 코드 수정: log-analyzer analyzer.normalize_severity (1차) + admin-api LogAnalysisCreate validator (2차).
-- Qdrant log_incidents 포인트 정리는 scripts/fix_qdrant_severity_error.py 로 별도 실행할 것
-- (stored-wins 승계 구조라 Qdrant를 정리하지 않으면 코드 배포 전 저장분이 계속 재발원이 됨 —
--  단, 코드의 승계 지점 정규화가 방어하므로 표시 정합성 목적).

UPDATE log_analysis_history SET severity = 'warning' WHERE severity = 'error';

UPDATE alert_history SET severity = 'warning' WHERE severity = 'error';

UPDATE incidents SET severity = 'warning' WHERE severity = 'error';
