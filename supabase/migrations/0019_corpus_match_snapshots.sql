-- -----------------------------------------------------------------------------
-- Migration : 0019_corpus_match_snapshots
-- Desc      : 匹配结果快照表 corpus_match_snapshots —— 每段语料只存一份「冻结」的完整匹配结果，
--             消除「刷新匹配页看到不同高/中/低」的漂浮：匹配一次→存整份结果→重访直接读档、
--             不再跑模型；仅当整理后正文（cleaned_text）变化（story_hash 变）或算法口径升级
--             （algo_version 变）时才作废旧档、静默重算一次落档。
--             存整份 FunnelMatchResult（src/services/matching.ts）；只新增此表，
--             不改 corpus / 不改 corpus_question_matches（反查表另有职责，不动）。
--             幂等：create table/index if not exists + drop policy if exists 再建，可安全重跑（对齐 0018）。
-- Created   : 2026-07-17
-- -----------------------------------------------------------------------------

-- corpus_id 作主键 = 一段语料至多一份快照（天然满足 unique）；corpus 删除级联清档。
-- result 存整份 FunnelMatchResult（含 questions / primary / secondary / noMatch 等，见 matching.ts）。
-- story_hash = sha256(cleaned_text)；algo_version = 萃取/排序/阈值口径版本（constants.RANKING_ALGO_VERSION）。
-- 命中判定（在服务端 api/matching/route.ts）= 存在 且 story_hash 一致 且 algo_version 一致。
create table if not exists public.corpus_match_snapshots (
  corpus_id    uuid primary key references public.corpus(id) on delete cascade,
  user_id      uuid not null,                          -- 存档归属用户（service_role 写入，显式带 user_id）
  result       jsonb not null,                         -- 整份 FunnelMatchResult
  story_hash   text not null,                          -- sha256(cleaned_text)，正文变即失效
  algo_version text,                                   -- 算法口径版本，升级即作废旧档重算
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 反查/巡检用：按用户列出其快照
create index if not exists corpus_match_snapshots_user_idx
  on public.corpus_match_snapshots (user_id);

-- 启用 RLS（启用本身幂等）
alter table public.corpus_match_snapshots enable row level security;

-- 读/写唯一入口是服务端 service_role（src/lib/db/match-snapshots.ts，service_role 绕 RLS）。
-- 本策略是对「客户端 anon key 直连」的第二道防线：仅本人可读写自己的行（对齐 0007 own_matches_all）。
drop policy if exists "own_match_snapshots_all" on public.corpus_match_snapshots;
create policy "own_match_snapshots_all" on public.corpus_match_snapshots for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
