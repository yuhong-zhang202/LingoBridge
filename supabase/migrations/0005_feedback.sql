-- -----------------------------------------------------------------------------
-- Migration : 0005_feedback
-- Desc      : 用户反馈表（崩溃自动带上下文 / 主动反馈）+ 索引 + RLS
-- Created   : 2026-06-12
-- -----------------------------------------------------------------------------

-- 用户反馈表（崩溃自动带上下文 / 主动反馈）
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'manual',         -- 'crash' | 'manual'
  message     text not null,
  context     jsonb not null default '{}'::jsonb,      -- { route, errorMessage }
  created_at  timestamptz not null default now()
);

create index if not exists feedback_user_created_idx on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;

create policy "own_feedback_insert" on public.feedback
  for insert with check (auth.uid() = user_id);
create policy "own_feedback_select" on public.feedback
  for select using (auth.uid() = user_id);
