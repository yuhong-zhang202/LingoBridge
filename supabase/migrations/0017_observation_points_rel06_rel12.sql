-- -----------------------------------------------------------------------------
-- Migration : 0017_observation_points_rel06_rel12
-- Desc      : 两处观察点变更合并为单个迁移（尚未执行）。
--
--   (1) 对齐 REL_06 名称到 extraction prompt 口径。
--       0003 曾把 REL_06 由「印象深刻的陌生人」改名为「印象深刻的弱关系」（语义扩宽），
--       但 extraction prompt / 萃取金标始终按「陌生人」窄口径标注，导致 DB 名与 prompt 漂移
--       —— "两边判的不是同一道题"。此处把 DB 名回改为 prompt 权威文案
--       「一个让你印象深刻的陌生人」，由 prompt 作真源（金标按 prompt 标的）。
--       仅改名，不改 layer / rich_threshold / 已有映射。观察点总数不变。
--
--   (2) 新增观察点 REL_12「一个让你印象深刻的人」——填补 REL_03(密友) 与 REL_06(陌生人)
--       之间的「熟人层」空档（同事/邻居/长辈/老师/店主/同学等 认识但非密友的人物描述）。
--       观察点由 48 → 49。
--       layer=rhythm（人物整体画像，同 REL_03）；rich_threshold=2（同 REL_03/REL_06）；
--       mapped_question_count=0（本迁移只建点位、不建映射；题目映射在 remap.v2 →
--       remap:links 阶段建立后再统计）。
--
-- Created   : 2026-07-16
-- Note      : 先不执行，待权威文档与映射复审清完后统一 apply。
-- -----------------------------------------------------------------------------

-- (1) REL_06 回改：对齐 extraction prompt「一个让你印象深刻的陌生人」
UPDATE observation_points
SET name = '一个让你印象深刻的陌生人'
WHERE code = 'REL_06';

-- (2) 新增 REL_12「熟人层」
INSERT INTO observation_points (code, dimension_id, name, layer, mapped_question_count, rich_threshold, sort_order)
VALUES ('REL_12', 'relationship', '一个让你印象深刻的人', 'rhythm', 0, 2, 12)
ON CONFLICT (code) DO NOTHING;
