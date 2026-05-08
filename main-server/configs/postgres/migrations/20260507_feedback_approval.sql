-- DEPRECATED 2026-05-08
-- 이 마이그레이션은 미배포 상태에서 통째 폐기되었습니다.
-- 후속 마이그레이션 20260508_feedback_incident_redesign.sql 가 alert_feedback 테이블을
-- 인시던트 단위로 재정의합니다. 이 파일을 운영 DB에 적용하지 마세요.
-- 만약 이미 적용된 환경이 있다면 재실행으로 인한 충돌을 막기 위해 그냥 무시되도록 처리됨.

SELECT 'deprecated migration — skipped' AS status;
