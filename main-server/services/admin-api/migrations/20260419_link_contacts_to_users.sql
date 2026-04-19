-- contacts 테이블에 user_id FK 추가 (사용자-담당자 연결)
ALTER TABLE contacts
    ADD COLUMN IF NOT EXISTS user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL;
