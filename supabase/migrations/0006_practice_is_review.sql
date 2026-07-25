-- -----------------------------------------------------------------------------
-- Migration : 0006_practice_is_review
-- Desc      : practice_sessions 加一列 is_review，区分"复练"（从题库/用完页发起）
--             与"故事链路末尾自带的练习"。复练月额度按此列统计。
-- Created   : 2026-06-18
-- -----------------------------------------------------------------------------

-- if exists：practice_sessions 的建表在 0016（事后补建），从零按序跑时本迁移先于建表；
-- 表不存在则此 ALTER 为 no-op，0016 建表时已含 is_review 列，最终态一致。
alter table if exists public.practice_sessions
  add column if not exists is_review boolean not null default false;
