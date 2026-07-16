-- -----------------------------------------------------------------------------
-- Migration : 0004_phrase_cards
-- Desc      : 词组记忆卡片（Leitner 间隔重复）表 + 索引 + RLS
-- Created   : 2026-06-12
-- -----------------------------------------------------------------------------

create table phrase_cards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(id) on delete cascade,
  text             text not null,          -- 英文词组
  meaning          text not null,          -- 中文释义
  scene            text,                   -- 适用场景
  card_group       text,                   -- 分类标签（感受 / 时间 / 行为 …）；group 是保留字故用 card_group
  source_word_id   text,                   -- 来源词组 id（= SavedWord.id，英文小写），去重用
  box              int not null default 1, -- Leitner 盒子等级 1..5
  due_at           timestamptz not null default now(),  -- 下次复习时间
  last_reviewed_at timestamptz,
  created_at       timestamptz not null default now()
);
create index phrase_cards_user_due_idx on phrase_cards (user_id, due_at);
create unique index phrase_cards_user_word_uidx on phrase_cards (user_id, source_word_id);

alter table phrase_cards enable row level security;
create policy "own_phrase_cards_all" on phrase_cards for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
