-- -----------------------------------------------------------------------------
-- Migration : 0009_saved_phrases
-- Desc      : 语料卡收藏表（我的表达库）—— practice→feedback 收藏的润色句落库 + 索引 + RLS。
--             语义沿用旧本地实现：允许重复（不加唯一约束），新收藏靠 created_at desc 天然排最前。
-- Created   : 2026-07-11
-- -----------------------------------------------------------------------------

create table if not exists public.saved_phrases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  original     text,
  optimized    text,
  note         text,
  part         smallint not null check (part in (1, 2, 3)),
  question_en  text,
  created_at   timestamptz not null default now()
);

create index if not exists saved_phrases_user_created_idx on public.saved_phrases (user_id, created_at desc);

alter table public.saved_phrases enable row level security;

create policy "own_saved_phrases_all" on public.saved_phrases for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
