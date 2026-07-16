-- -----------------------------------------------------------------------------
-- Migration : 0010_saved_words
-- Desc      : 词组收藏表（题目分析里收藏的可用词组）+ 索引 + RLS。
--             与 phrase 不同：id 为内容派生稳定键（词组英文），add 是 upsert 覆盖语义（同一词组只存一条），
--             故用复合主键 (user_id, word_id)。group 是 SQL 保留字，列名用 group_tag（映射层还原 camelCase 的 group）。
-- Created   : 2026-07-11
-- -----------------------------------------------------------------------------

create table if not exists public.saved_words (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  word_id      text not null,            -- 内容键 = 词组英文（同 SavedWord.id / .text）
  meaning      text,
  scene        text,
  group_tag    text,                     -- 映射回应用层 SavedWord.group（避开 SQL 保留字 group）
  level        text,
  question_en  text,
  created_at   timestamptz not null default now(),
  primary key (user_id, word_id)
);

create index if not exists saved_words_user_created_idx on public.saved_words (user_id, created_at desc);

alter table public.saved_words enable row level security;

create policy "own_saved_words_all" on public.saved_words for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
