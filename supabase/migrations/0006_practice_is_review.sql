-- -----------------------------------------------------------------------------
-- Migration : 0006_practice_is_review
-- Desc      : practice_sessions 加一列 is_review，区分"复练"（从题库/用完页发起）
--             与"故事链路末尾自带的练习"。复练月额度按此列统计。
-- Created   : 2026-06-18
-- -----------------------------------------------------------------------------

alter table public.practice_sessions
  add column if not exists is_review boolean not null default false;
