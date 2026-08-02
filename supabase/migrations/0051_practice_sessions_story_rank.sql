-- -----------------------------------------------------------------------------
-- Migration : 0051_practice_sessions_story_rank
-- Desc      : practice_sessions 增两列可空埋点字段 —— story_id uuid / rank int ——
--             记录「这次练习完成，是从哪个故事(story_id)、点开的排第几位(rank)的题走完的」。
--             用途：把「用户选了排第几位的题」这一选题行为，从匹配页(question_opened)一路贯通到
--             练习完成侧，做选题→完成的漏斗与 ranking 排序质量的完成率验证（此前完成侧完全无此信号）。
--
--             口径：只有故事流(from=matching)才有 story_id + rank；雅思泛题池流(qid 直达、不走排序)
--             两列均留 null。历史行一律 null，不回填（无从追溯当年的排位）。
--             不加外键(纯埋点引用列，避免与 corpus/questions 生命周期耦合，story 删除不应影响历史练习记录)。
--
--             幂等：add column if not exists，可安全重跑；只加列、不改现有列，现有数据不受影响、不丢。
--             ⚠️ 数据库改动，需部署方在 Supabase 控制台 SQL Editor 手动跑（形态同 0018-0023、0046-0050）：
--                本文件不自动执行；未跑前代码 insert 带的这两个键会因列不存在而报错——
--                故代码侧对这两列做「列存在才带」的兼容不现实，须先跑本迁移再部署带列的应用代码。
-- Created   : 2026-08-02
-- -----------------------------------------------------------------------------

alter table public.practice_sessions add column if not exists story_id uuid;
alter table public.practice_sessions add column if not exists rank int;
