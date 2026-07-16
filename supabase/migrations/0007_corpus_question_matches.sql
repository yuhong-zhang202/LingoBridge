-- -----------------------------------------------------------------------------
-- Migration : 0007_corpus_question_matches
-- Desc      : 语料 ↔ 题目 匹配结果持久化 + 反查索引，供「练习题目」按题列出可用语料
-- Created   : 2026-06-21
-- -----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 匹配结果：语料 ↔ 题目（同一对只存一行，重复写用 upsert）
-- match_level：故事流为 high/mid/low（取自相关性档位），雅思直达流为 chosen
-- ---------------------------------------------------------------------------
create table corpus_question_matches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  corpus_id   uuid not null references corpus(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  match_level text not null check (match_level in ('high','mid','low','chosen')),
  created_at  timestamptz not null default now(),
  unique (corpus_id, question_id)
);
-- 反查用：按题号列出当前用户的匹配语料
create index corpus_question_matches_user_question_idx
  on corpus_question_matches (user_id, question_id);

-- ---------------------------------------------------------------------------
-- RLS：仅本人可读写自己的行（按 user_id）
-- ---------------------------------------------------------------------------
alter table corpus_question_matches enable row level security;
create policy "own_matches_all" on corpus_question_matches for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
