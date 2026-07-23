-- -----------------------------------------------------------------------------
-- Migration : 0030_anki_cards
-- Desc      : Anki 题卡表（Leitner 间隔重复）+ 索引 + RLS + part3 不变式触发器。
--
--   语义（方案 §1）：一张 anki_card = 某用户对某道题的一张记忆卡。
--     - (user_id, question_id) 唯一 → 复习端点走 upsert on conflict 懒物化：
--       卡行首次 SRS 手势 / 存对子时才 INSERT，此前不存在（省空行）。
--     - corpus_id 可空：null = 该题无语料，此卡即「真相源」标记（part3 恒如此）。
--     - generated_answer 可空：后台生成任务成功才回填（见 0031）；生成前为 null。
--     - edited_answer 可空：用户手动编辑覆盖，优先级高于 generated_answer（展示层决定）。
--     - parent_card_id：part3 卡指向其所属 part2 卡（part2/part3 同题串联），可空。
--     - box / due_at / last_reviewed_at：Leitner 字段，与 src/lib/srs.ts 对齐
--       （box 1..7，间隔 {1,2,4,7,15,30,60} 天；nextBox 记住升一格封顶 7、没记住回 1）。
--
--   part3 不变式（方案 §12，DB 层强制，不靠应用层自觉）：
--     part3 卡的 corpus_id 恒 null、generated_answer 恒 null。part 存在 questions 表、
--     不在本表，CHECK 无法跨表引用，故用 BEFORE INSERT/UPDATE 触发器 join questions
--     取 part 强制——比 denormalize 一个 part 列（会与 questions 漂移）或纯应用层自觉都稳。
--
--   幂等：create table / index / policy / function 均 if not exists 或 drop 后重建，可安全重跑。
-- Created   : 2026-07-23
-- -----------------------------------------------------------------------------

create table if not exists public.anki_cards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  question_id      uuid not null references public.questions(id) on delete cascade,
  corpus_id        uuid references public.corpus(id) on delete set null,  -- 可空；null=无语料=真相源标记
  parent_card_id   uuid references public.anki_cards(id) on delete set null, -- part3 卡 → 其 part2 卡
  generated_answer text,                                    -- 后台生成成功才回填（part3 恒 null）
  edited_answer    text,                                    -- 用户编辑覆盖
  box              int not null default 1 check (box between 1 and 7), -- Leitner 盒子 1..7（对齐 srs.ts）
  due_at           timestamptz not null default now(),      -- 下次复习到期时间
  last_reviewed_at timestamptz,                             -- 上次复习时间（未复习为 null）
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- (user_id, question_id) 唯一 → 支撑复习端点 upsert on conflict 懒物化；一用户一题至多一卡。
create unique index if not exists anki_cards_user_question_uidx
  on public.anki_cards (user_id, question_id);

-- 复习队列：按用户 + 到期时间拉取到期卡。
create index if not exists anki_cards_user_due_idx
  on public.anki_cards (user_id, due_at);

-- 反查某 part2 卡的 part3 子卡。
create index if not exists anki_cards_parent_idx
  on public.anki_cards (parent_card_id);

-- ── part3 不变式触发器 ────────────────────────────────────────────────
-- part 来自 questions 表；CHECK 不能跨表，故 BEFORE INSERT/UPDATE 时 join questions 取 part 强制。
-- 不用 security definer：questions 为公开引用数据（无 RLS，authenticated/anon 均可读），
-- 触发器以调用者权限即可读到；set search_path 仍固定为提权/表名劫持防护。
create or replace function public.enforce_anki_part3_invariant()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  q_part smallint;
begin
  select part into q_part from public.questions where id = new.question_id;

  -- 题不存在时不在此处报（交由 FK 约束拒绝）；仅当确为 part3 时强制不变式。
  if q_part = 3 then
    if new.corpus_id is not null then
      raise exception 'ANKI_PART3_INVARIANT: part3 卡的 corpus_id 必须为 null（part3 无语料/真相源）';
    end if;
    if new.generated_answer is not null then
      raise exception 'ANKI_PART3_INVARIANT: part3 卡的 generated_answer 必须为 null（part3 不后台生成答案）';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_anki_part3_invariant_trg on public.anki_cards;
create trigger enforce_anki_part3_invariant_trg
  before insert or update on public.anki_cards
  for each row execute function public.enforce_anki_part3_invariant();

-- ── RLS：own-rows（对齐 0004 phrase_cards own_phrase_cards_all）────────
alter table public.anki_cards enable row level security;
drop policy if exists "own_anki_cards_all" on public.anki_cards;
create policy "own_anki_cards_all" on public.anki_cards for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
