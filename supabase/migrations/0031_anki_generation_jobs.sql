-- -----------------------------------------------------------------------------
-- Migration : 0031_anki_generation_jobs
-- Desc      : Anki 答案生成任务队列表 + 领取索引 + RLS。
--
--   为什么要落表（方案 §1/§12）：答案生成是后台 AI 调用，serverless「发了就忘」
--   （fire-forget）一旦函数实例回收就丢单。故生成请求必须先落这张队列表，由 drain
--   worker 幂等领取执行、失败可退避重试，天然抗丢单 / 抗重复。
--
--   领取（方案 §12）：drain 用 `SELECT ... FOR UPDATE SKIP LOCKED` 领 status='pending'
--   且 next_attempt_at <= now() 的行，多 worker 并发不抢同一单。anki_gen_jobs_claim_idx
--   即为此路径服务（按 status + next_attempt_at）。
--
--   退避：领取即 attempts+1、置 status='processing'；成功置 'done'；失败置回 'pending'
--   或 'failed'（attempts >= max_attempts 判死信），并把 next_attempt_at 推后（指数退避）。
--
--   card_id 可空：懒物化下卡行可能尚未 INSERT（0030），故也冗余 (user_id, question_id)
--   以定位目标；卡行物化后回填 card_id。
--
--   幂等：create table / index / policy 均 if not exists 或 drop 后重建，可安全重跑。
-- Created   : 2026-07-23
-- -----------------------------------------------------------------------------

create table if not exists public.anki_generation_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  question_id     uuid not null references public.questions(id) on delete cascade,
  card_id         uuid references public.anki_cards(id) on delete cascade, -- 懒物化后回填
  corpus_id       uuid references public.corpus(id) on delete set null,    -- 生成所依语料（可空）
  status          text not null default 'pending'
                    check (status in ('pending', 'processing', 'done', 'failed')),
  attempts        int  not null default 0,                 -- 已尝试次数
  max_attempts    int  not null default 5,                 -- 超过即判死信（failed）
  next_attempt_at timestamptz not null default now(),      -- 退避：此刻起方可被领取
  last_error      text,                                    -- 最近一次失败原因（诊断用）
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 领取路径索引：drain 按 status + next_attempt_at 取待办（配合 FOR UPDATE SKIP LOCKED）。
create index if not exists anki_gen_jobs_claim_idx
  on public.anki_generation_jobs (status, next_attempt_at);

-- 防重复入队：同一 (user_id, question_id) 至多一条「未完成」任务
-- （done/failed 不占坑，允许后续重新入队重生成）。
create unique index if not exists anki_gen_jobs_active_uidx
  on public.anki_generation_jobs (user_id, question_id)
  where status in ('pending', 'processing');

-- ── RLS：own-rows 只读（UI 可轮询自己任务的生成状态）────────────────────
-- 入队与执行均在服务端 service_role（绕 RLS）完成，故【不建客户端写策略】：
-- 启用 RLS 后无 insert/update/delete 策略即默认拒绝客户端写（同 0014/0023 范式）。
alter table public.anki_generation_jobs enable row level security;
drop policy if exists "own_anki_gen_jobs_select" on public.anki_generation_jobs;
create policy "own_anki_gen_jobs_select" on public.anki_generation_jobs for select to authenticated
  using (auth.uid() = user_id);
