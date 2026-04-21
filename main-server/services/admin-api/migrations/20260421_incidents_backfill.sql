-- 인시던트 백필: 과거 alert_history 중 incident_id IS NULL 인 레코드를
-- 30분 타임윈도우·system_id 단위로 그루핑하여 incidents + incident_timeline 생성
--
-- 실행 조건: 20260421_incidents.sql 로 테이블이 먼저 생성되어 있어야 함.
-- 재실행 안전: WHERE incident_id IS NULL 로만 처리되므로 이미 연결된 행은 건드리지 않음.

DO $$
DECLARE
    alert_rec RECORD;
    current_incident_id INTEGER;
    current_system_id INTEGER;
    current_window_start TIMESTAMP;
BEGIN
    current_incident_id := NULL;
    current_system_id := -1;   -- NULL 과 구분되는 센티넬

    FOR alert_rec IN
        SELECT id, system_id, severity, title, created_at, resolved_at
        FROM alert_history
        WHERE incident_id IS NULL
        ORDER BY COALESCE(system_id, 0), created_at
    LOOP
        -- 새 인시던트 시작 조건: 시스템이 바뀌었거나, 30분 창을 벗어났거나, 아직 인시던트가 없음
        IF current_incident_id IS NULL
           OR current_system_id IS DISTINCT FROM COALESCE(alert_rec.system_id, 0)
           OR alert_rec.created_at - current_window_start > interval '30 minutes' THEN

            INSERT INTO incidents (
                system_id, title, severity, status, detected_at, alert_count,
                created_at, updated_at
            ) VALUES (
                alert_rec.system_id,
                alert_rec.title,
                alert_rec.severity,
                'open',
                alert_rec.created_at,
                1,
                alert_rec.created_at,
                alert_rec.created_at
            ) RETURNING id INTO current_incident_id;

            current_system_id := COALESCE(alert_rec.system_id, 0);
            current_window_start := alert_rec.created_at;
        ELSE
            -- 같은 그룹: alert_count 증가, 심각도 상향(critical 우선)
            UPDATE incidents
            SET alert_count = alert_count + 1,
                severity = CASE
                    WHEN alert_rec.severity = 'critical' THEN 'critical'
                    WHEN severity = 'critical' THEN severity
                    WHEN alert_rec.severity = 'warning' THEN 'warning'
                    ELSE severity
                END,
                updated_at = alert_rec.created_at
            WHERE id = current_incident_id;
        END IF;

        -- 알림을 인시던트에 연결
        UPDATE alert_history
        SET incident_id = current_incident_id
        WHERE id = alert_rec.id;

        -- 타임라인 이벤트 추가 (백필 표시 포함)
        INSERT INTO incident_timeline (
            incident_id, event_type, description, actor_name, created_at
        ) VALUES (
            current_incident_id,
            'alert_added',
            '[' || UPPER(alert_rec.severity) || '] ' ||
                LEFT(COALESCE(alert_rec.title, ''), 200) || ' (백필)',
            'system',
            alert_rec.created_at
        );
    END LOOP;

    -- 모든 연결 알림이 resolved 된 인시던트는 인시던트 자체도 resolved 로 마감
    UPDATE incidents i
    SET status = 'resolved',
        resolved_at = sub.max_resolved
    FROM (
        SELECT incident_id, MAX(resolved_at) AS max_resolved
        FROM alert_history
        WHERE incident_id IS NOT NULL
        GROUP BY incident_id
        HAVING BOOL_AND(resolved_at IS NOT NULL)
    ) sub
    WHERE i.id = sub.incident_id AND i.status = 'open';
END $$;
