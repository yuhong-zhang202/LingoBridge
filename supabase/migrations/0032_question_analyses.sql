-- -----------------------------------------------------------------------------
-- Migration : 0032_question_analyses
-- Desc      : 题目预生成静态分析表（公开可读）+ 季度失效索引 + RLS。
--
--   语义（方案 §1）：每道题预生成一份静态分析（analysis jsonb，与用户无关、全站共享），
--   题卡展示时直接读档、不再实时调 AI。question_id 作主键 = 一题至多一份分析。
--
--   season（对齐 0027 换题季 + 0019 快照失效范式）：记录该份分析是「按哪个季度的题面」
--   生成的。换题季题面原地更新（questions 行 id 不变、season 变，见 0027）后，旧分析即
--   过季 → 命中判定 = question_analyses.season 与 questions.season 一致；不一致则重生成。
--   question_analyses_season_idx 支撑「找出所有过季分析批量重生成」的巡检查询。
--
--   公开可读（方案 §1）：分析非隐私、全站共享，anon/authenticated 均可 select；
--   写入限 service-role（预生成脚本 / 后台任务绕 RLS），故【不建客户端写策略】。
--
--   幂等：create table / index / policy 均 if not exists 或 drop 后重建，可安全重跑。
-- Created   : 2026-07-23
-- -----------------------------------------------------------------------------

create table if not exists public.question_analyses (
  question_id uuid primary key references public.questions(id) on delete cascade,
  season      text not null,                               -- 生成所依题面的季度（'YYYY-MM'，对齐 0027）
  analysis    jsonb not null,                              -- 整份静态分析
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 巡检/失效：按 season 找出过季分析批量重生成。
create index if not exists question_analyses_season_idx
  on public.question_analyses (season);

-- ── RLS：公开可读、写限 service_role（对齐 0001 ref_read_* + 0014 不建写策略）──
alter table public.question_analyses enable row level security;
drop policy if exists "question_analyses_read" on public.question_analyses;
create policy "question_analyses_read" on public.question_analyses for select to anon, authenticated
  using (true);
