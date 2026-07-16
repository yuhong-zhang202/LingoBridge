-- -----------------------------------------------------------------------------
-- Migration : 0011_saved_pronunciations
-- Desc      : 发音收藏表（练习页点词收藏的正音）+ 索引 + RLS。
--             与 phrase 不同：id 为内容派生稳定键（intended__heard 小写），add 是 upsert 覆盖语义，
--             故用复合主键 (user_id, pron_id)。ipa_*/tip 为 AI 生成的音标/提示，首次打开缓存后就地更新。
-- Created   : 2026-07-11
-- -----------------------------------------------------------------------------

create table if not exists public.saved_pronunciations (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  pron_id       text not null,           -- 内容键 = intended__heard 小写（同 SavedPronunciation.id）
  intended      text,
  heard         text,
  context       text,
  ipa_intended  text,                     -- AI 缓存：想说词音标（可空）
  ipa_heard     text,                     -- AI 缓存：被听成词音标（可空）
  tip           text,                     -- AI 缓存：怎么念提示（可空）
  created_at    timestamptz not null default now(),
  primary key (user_id, pron_id)
);

create index if not exists saved_pronunciations_user_created_idx on public.saved_pronunciations (user_id, created_at desc);

alter table public.saved_pronunciations enable row level security;

create policy "own_saved_pronunciations_all" on public.saved_pronunciations for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
