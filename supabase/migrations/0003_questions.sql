-- -----------------------------------------------------------------------------
-- Migration : 0003_questions
-- Desc      : 题库表 + 题目-观察点映射表 + 索引；同步观察点变更（GRO_07 / REL_06）
-- Created   : 2026-06-03
-- -----------------------------------------------------------------------------

-- ── 1. questions（题目表）
CREATE TABLE IF NOT EXISTS questions (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  part             SMALLINT NOT NULL CHECK (part IN (1, 2, 3)),
  topic            TEXT NOT NULL,
  question_text    TEXT NOT NULL,
  question_text_zh TEXT,
  cue_card_title   TEXT,
  cue_card_title_zh TEXT,
  is_new           BOOLEAN DEFAULT FALSE,
  topic_only       BOOLEAN DEFAULT FALSE,
  parent_card_id   UUID REFERENCES questions(id),
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ── 2. question_observation_links（题目-观察点映射）
-- observation_point_id 存观察点 code（如 'EMO_01'），逻辑引用 observation_points.code
CREATE TABLE IF NOT EXISTS question_observation_links (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id          UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  observation_point_id TEXT NOT NULL,
  is_primary           BOOLEAN DEFAULT TRUE,
  UNIQUE(question_id, observation_point_id)
);

-- ── 3. 索引
CREATE INDEX IF NOT EXISTS idx_questions_part       ON questions(part);
CREATE INDEX IF NOT EXISTS idx_questions_topic_only ON questions(topic_only);
CREATE INDEX IF NOT EXISTS idx_questions_parent     ON questions(parent_card_id);
CREATE INDEX IF NOT EXISTS idx_qol_question         ON question_observation_links(question_id);
CREATE INDEX IF NOT EXISTS idx_qol_observation      ON question_observation_links(observation_point_id);

-- ── 4. 观察点变更（适配已有 schema：code/dimension_id/name/layer/rich_threshold/sort_order）

-- 新增 GRO_07：一次重要的选择/决定
INSERT INTO observation_points (code, dimension_id, name, layer, mapped_question_count, rich_threshold, sort_order)
VALUES ('GRO_07', 'growth', '一次重要的选择/决定', 'fluctuation', 2, 1, 7)
ON CONFLICT (code) DO NOTHING;

-- 更新 REL_06：从「印象深刻的陌生人」扩为「印象深刻的弱关系」
UPDATE observation_points
SET name = '印象深刻的弱关系'
WHERE code = 'REL_06';
