-- contacts 테이블 구조 개선: name/email 제거, user_id 필수화
-- 모든 담당자는 users 테이블에 등록된 사용자와 1:1 연결

-- 1. email이 일치하는 user와 연결 (기존 레거시 contacts 자동 매핑)
UPDATE contacts c
SET user_id = u.id
FROM users u
WHERE c.email = u.email AND c.user_id IS NULL;

-- 2. 여전히 user_id 없는 contacts 제거 (매칭 불가 레거시 데이터)
DELETE FROM contacts WHERE user_id IS NULL;

-- 3. user_id NOT NULL + CASCADE로 변경
ALTER TABLE contacts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_user_id_fkey;
ALTER TABLE contacts
    ADD CONSTRAINT contacts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- 4. name, email 컬럼 삭제
ALTER TABLE contacts DROP COLUMN IF EXISTS name;
ALTER TABLE contacts DROP COLUMN IF EXISTS email;
