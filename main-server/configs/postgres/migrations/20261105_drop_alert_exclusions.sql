-- 20261105: 폐기된 스키마 정리 (선택 적용, 기능 영향 없음)
--   1) alert_exclusions 테이블 DROP — Qdrant 유사도 재분류로 대체된 기능. ORM/라우터/코드 모두 제거됨.
--   2) systems.host / os_type / system_type 컬럼 DROP — 어떤 서비스도 읽거나 쓰지 않음.
--
-- 적용 전 확인 (감사 목적으로 보존이 필요한 데이터가 있는지):
--   SELECT count(*) FROM alert_exclusions;
-- 이 테이블이 없는 환경(이미 DROP 완료)에서도 IF EXISTS 로 안전하게 실행된다.
--
-- log_analysis_history.exclusion_rule_id 는 컬럼을 유지한다(레거시 이력 값 보존).
-- 과거 FK(log_analysis_history_exclusion_rule_id_fkey)가 남아 있어도 DROP TABLE ... CASCADE 가
-- 제약만 제거하고 컬럼·데이터는 건드리지 않는다.

DROP TABLE IF EXISTS alert_exclusions CASCADE;

ALTER TABLE systems DROP COLUMN IF EXISTS host;
ALTER TABLE systems DROP COLUMN IF EXISTS os_type;
ALTER TABLE systems DROP COLUMN IF EXISTS system_type;
