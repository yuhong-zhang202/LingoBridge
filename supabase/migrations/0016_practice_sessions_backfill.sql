-- -----------------------------------------------------------------------------
-- Migration : 0016_practice_sessions_backfill
-- Desc      : 事后补录 practice_sessions 建表 DDL —— 该表被 0006 alter、被代码读写，但全部迁移文件里
--             找不到它的 create table（当年在 Supabase 后台手建、未纳入迁移历史），造成 schema drift：
--             仓库无法作为库结构的唯一事实来源，新环境（CI / 本地重建）跑迁移建不出此表，其 FK/RLS 也无从验证。
--             ⚠️ 本文件结构系「基于代码所有读写字段反推的重建」（Claude Code 无法访问线上库），
--             须人工与 Supabase 后台实际 DDL 逐项核对一致后再纳入部署，切勿在生产库自动执行。
--             幂等：create table if not exists / drop policy if exists + create policy，可安全重跑。
-- Created   : 2026-07-12
-- -----------------------------------------------------------------------------

-- question_id 与 on delete 行为为推断项，核对时重点确认（尤其题目删除是否应保留练习记录）。
create table if not exists public.practice_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  question_id  uuid references public.questions(id) on delete set null,   -- 代码 insert 时可传 null；题目删除不应连带删练习记录（推断，须核对）
  is_review    boolean not null default false,                            -- 0006 已单独 alter；建表含此列，语义/默认值与 0006 一致，不冲突（表已存在时整段 create 被跳过）
  created_at   timestamptz not null default now()                         -- 复练月计数按 created_at >= 当月 1 日统计
);

alter table public.practice_sessions enable row level security;

-- own 策略：对齐其余用户表（saved_phrases 等）—— 本人可读写自己的练习记录
drop policy if exists "own_practice_sessions_all" on public.practice_sessions;
create policy "own_practice_sessions_all" on public.practice_sessions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
