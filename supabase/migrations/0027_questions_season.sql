-- -----------------------------------------------------------------------------
-- Migration : 0027_questions_season
-- Desc      : 题库增加「季度」字段，支持换题季软下架（过季题保留但不进匹配召回）。
--
--   season 语义：「该题最近一次在考的季度」，格式 'YYYY-MM'
--     （每年 01 / 05 / 09 三个换题季）。存量行经 DEFAULT 自动标为 '2026-01'。
--
--   软下架机制：
--     - 保留题在换季导入时会被「原地更新」为新季度（行与 id 不变，
--       question_observation_links 的观察点链接因此自动保留，无需重建）；
--     - 消失题停留在旧季度即为「已过季」——行仍在库，但召回时按当季过滤掉，
--       不进匹配召回、不删除（历史练习记录与外键引用不受影响）。
--
--   idx_questions_season：召回查询按 season 过滤当季题，加索引避免全表扫。
--
-- Created   : 2026-07-21
-- Note      : 本迁移须在 Supabase SQL Editor 手动执行——仓库无 CLI，
--             DDL 不能走 REST 通道。
-- -----------------------------------------------------------------------------

-- (1) 新增 season 列，存量行经 DEFAULT 落为首个季度 '2026-01'
ALTER TABLE questions ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT '2026-01';

-- (2) 召回按当季过滤，建索引
CREATE INDEX IF NOT EXISTS idx_questions_season ON questions(season);
