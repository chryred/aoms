-- system_hosts: 시스템별 서버 IP 다중 등록
CREATE TABLE IF NOT EXISTS system_hosts (
    id          SERIAL PRIMARY KEY,
    system_id   INTEGER REFERENCES systems(id) ON DELETE CASCADE,
    host_ip     VARCHAR(100) NOT NULL,
    role_label  VARCHAR(50),
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(system_id, host_ip)
);

-- 챗봇 복합 도구 등록
INSERT INTO chat_tools (name, description, executor, input_schema, is_enabled)
VALUES (
    'ems_get_resources_by_system',
    '시스템 표시 이름(display_name)으로 EMS 서버 목록과 resource_id를 조회합니다. 이중화된 WAS/DB 등 다수 서버가 있어도 한 번에 전체 반환합니다. IP가 미등록된 경우 안내 메시지를 반환합니다.',
    'ems',
    '{
        "type": "object",
        "properties": {
            "system_display_name": {
                "type": "string",
                "description": "조회할 시스템의 표시 이름 (부분 일치 가능). 예: 통합고객 시스템"
            }
        },
        "required": ["system_display_name"]
    }',
    true
)
ON CONFLICT (name) DO UPDATE SET
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema;
