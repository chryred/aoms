-- Migration: 20260505_add_knowledge_guides
-- 챗봇 이미지+텍스트 응답을 위한 가이드 문서 테이블 추가 (Approach B)
-- 적용: psql -U synapse -d synapse -f 20260505_add_knowledge_guides.sql

-- 가이드 문서 (텍스트 + 메타 + C 확장용 steps JSONB)
CREATE TABLE IF NOT EXISTS knowledge_guides (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    system_id   INTEGER      REFERENCES systems(id) ON DELETE SET NULL,   -- NULL=전체 공통 가이드
    title       VARCHAR(255) NOT NULL,
    content     TEXT         NOT NULL,           -- 답변 텍스트 (자유 형식 Markdown)
    category    VARCHAR(50),                     -- 'howto', 'error', 'navigation'
    tags        TEXT[]       NOT NULL DEFAULT '{}',
    steps       JSONB,                           -- C 확장용: [{step, text, image_id: <UUID>}]
    created_by  INTEGER      REFERENCES contacts(id) ON DELETE SET NULL,  -- 등록 담당자 (admin 또는 operator)
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_guides_system     ON knowledge_guides(system_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_guides_category   ON knowledge_guides(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_guides_created_by ON knowledge_guides(created_by);

-- 가이드 첨부 이미지 (sort_order 순 표시, step_number로 C 확장 준비)
CREATE TABLE IF NOT EXISTS guide_images (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    guide_id     UUID         NOT NULL REFERENCES knowledge_guides(id) ON DELETE CASCADE,
    file_path    VARCHAR(500) NOT NULL,   -- KNOWLEDGE_DOCS_DIR 기준 상대 경로 (예: 'images/{guide_id}_{uuid}.png')
    alt_text     VARCHAR(255),           -- RAG 컨텍스트 + 접근성
    sort_order   INTEGER      NOT NULL DEFAULT 0,
    step_number  INTEGER,                -- NULL=문서 첨부, 값 있으면 특정 스텝 이미지 (C 확장용)
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guide_images_guide ON guide_images(guide_id);
