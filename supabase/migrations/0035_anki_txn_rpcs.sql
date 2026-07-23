-- -----------------------------------------------------------------------------
-- Migration : 0035_anki_txn_rpcs
-- Desc      : Anki 流水线上线前审计（2026-07-23）的正确性/崩溃恢复修复，全部落 DB 侧：
--
--   ① swap_anki_corpus   （审计 C，§11 正确性红线）：换语料收敛成【单事务原子】RPC。
--      旧实现是 app 层多条独立 DML（清卡背 → 改在途任务 → 单独 enqueue），中间失败会留下
--      「卡背已清空、任务却指旧语料 / 未入队」的半成品 → 旧答案复活 / 卡背永久空白。
--      本 RPC 在一个事务里：清空卡背 + 卡行改指新语料（懒物化下卡行不存在则物化插入）+
--      在途任务改指新语料 + 兜底入队（同题已有 active 任务则 do-nothing）。与 0033 enqueue 同范式。
--
--   ② unbind_anki_corpus （审计 C）：删语料同样收敛成单事务 RPC —— 卡行 corpus_id 置 null +
--      清空卡背（保留 SRS 进度）+ 撤在途任务。杜绝「卡背已清空、任务未撤 → 旧语料答案回填复活」。
--
--   ③ claim_anki_generation_jobs（审计 D，崩溃恢复）：加 visibility-timeout 孤儿回收。
--      旧实现只领 status='pending'；worker 被容器重启/超时杀掉后任务永卡 'processing'、active 索引
--      又挡重新入队 → 卡背永久空白。本次 CREATE OR REPLACE 让 claim 同时回收「status='processing'
--      且 updated_at 早于 stale 阈值」的行（视为 worker 已死）。签名不变（仍 p_limit int），
--      故安全 replace。
--
--   ④ get_anki_cards（审计 E，一致性）：is_answered 的空串处理与 app 层 list.ts 的 backKind 对齐——
--      统一「空串视同无内容」。旧 SQL 认 generated_answer='' / edited_answer='' 为「已回答」，
--      而 JS backKindOf 认空串不算内容，二者对同一行会给出矛盾结论。本次 CREATE OR REPLACE 把
--      is_answered 里的 generated_answer / edited_answer 判定改为 nullif(x,'') is not null（空串=无内容）。
--      函数体其余部分与 0034 逐字一致（仅此一处语义修正）。
--
--   均只由服务端 service_role 经 RPC 调用（绕 RLS）；不加 security definer（service_role 本就全权，
--   与 0033/0034 同范式），仅固定 search_path 防表名劫持。幂等：全部 create or replace，可安全重跑。
-- Created   : 2026-07-23
-- -----------------------------------------------------------------------------

-- ① 换语料（单事务原子）：清卡背 + 卡行改指新语料（懒物化则物化）+ 在途任务改指新语料 + 兜底入队。
--    返回卡行 id（供调用方回填/展示）。
create or replace function public.swap_anki_corpus(
  p_user_id     uuid,
  p_question_id uuid,
  p_corpus_id   uuid
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_card_id uuid;
begin
  -- 卡行：懒物化下可能尚未 INSERT → upsert。首次插入按新语料建（generated_answer 取表默认 null）；
  -- 已存在则清空旧卡背（§11 红线）+ 改指新语料，绝不动 box/due_at/edited_answer（复习进度与用户编辑不受换语料影响）。
  insert into public.anki_cards (user_id, question_id, corpus_id)
    values (p_user_id, p_question_id, p_corpus_id)
    on conflict (user_id, question_id)
      do update set corpus_id        = excluded.corpus_id,
                    generated_answer = null,
                    updated_at       = now()
    returning id into v_card_id;

  -- 在途任务改指新语料（不动 status/attempts —— 那是 drain 的状态机职责）。仅覆盖 pending/processing。
  update public.anki_generation_jobs
     set corpus_id = p_corpus_id, updated_at = now()
   where user_id = p_user_id
     and question_id = p_question_id
     and status in ('pending', 'processing');

  -- 兜底入队：若已有 active 任务（已被上一步改指新语料）则命中部分唯一索引 do-nothing；若无则新插一条。
  insert into public.anki_generation_jobs (user_id, question_id, card_id, corpus_id)
    values (p_user_id, p_question_id, v_card_id, p_corpus_id)
    on conflict (user_id, question_id)
      where status in ('pending', 'processing')
      do nothing;

  return v_card_id;
end;
$$;

-- ② 删语料 / unbind（单事务原子）：卡行 corpus_id 置 null + 清卡背（保留 SRS 进度）+ 撤在途任务。
--    卡行不存在时 update 命中 0 行（本就无对子可删、无卡背可复活），语义正确、无需报错。
create or replace function public.unbind_anki_corpus(
  p_user_id     uuid,
  p_question_id uuid
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.anki_cards
     set corpus_id = null, generated_answer = null, updated_at = now()
   where user_id = p_user_id
     and question_id = p_question_id;

  -- 撤在途任务（pending/processing）：删除即释放 0031 的 active 部分唯一索引占位，卡不再被重生成。
  delete from public.anki_generation_jobs
   where user_id = p_user_id
     and question_id = p_question_id
     and status in ('pending', 'processing');
end;
$$;

-- ③ 领取 + 孤儿回收（visibility timeout）：
--    领 (status='pending' 且到点) 或 (status='processing' 且 updated_at 早于 stale 阈值 = worker 疑似已死)。
--    领取即置 processing、attempts+1，返回被领取的整行。SKIP LOCKED 让多 worker 并发不抢同一单。
create or replace function public.claim_anki_generation_jobs(p_limit int)
returns setof public.anki_generation_jobs
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- ⚠️ 孤儿回收阈值：processing 行超过此时长未更新即视为 worker 已死、可被重新领取。
  --    15 分钟是【保守默认】——远大于单条卡背正常生成耗时（秒级），只回收真正卡死的任务；
  --    取太短会把「正常但偏慢」的在途任务误抢 → 重复生成。待部署侧确认 Zeabur 容器超时/被杀行为后再调。
  v_stale interval := interval '15 minutes';
begin
  return query
  update public.anki_generation_jobs j
     set status     = 'processing',
         attempts   = j.attempts + 1,
         updated_at = now()
   where j.id in (
     select c.id
       from public.anki_generation_jobs c
      where (c.status = 'pending'    and c.next_attempt_at <= now())
         or (c.status = 'processing' and c.updated_at < now() - v_stale)
      order by c.next_attempt_at
      for update skip locked
      limit p_limit
   )
  returning j.*;
end;
$$;

-- ④ get_anki_cards：与 0034 逐字一致，仅把 is_answered 的空串处理对齐 app 层（空串视同无内容）。
--    改动点：主行 / part3 子行的 is_answered 用 nullif(generated_answer,'') / nullif(edited_answer,'')。
create or replace function public.get_anki_cards(
  p_user_id uuid,
  p_season  text,
  p_part    smallint,
  p_scope   text
)
returns table (
  question_id        uuid,
  part               smallint,
  parent_question_id uuid,
  topic              text,
  question_text      text,
  question_text_zh   text,
  cue_card_title     text,
  cue_card_title_zh  text,
  season             text,
  corpus_id          uuid,
  generated_answer   text,
  edited_answer      text,
  analysis           jsonb,
  box                int,
  due_at             timestamptz,
  last_reviewed_at   timestamptz,
  has_card           boolean,
  is_answered        boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  with prim as (
    select
      q.id                as q_id,
      q.part              as q_part,
      q.parent_card_id    as parent_qid,
      q.topic, q.question_text, q.question_text_zh,
      q.cue_card_title, q.cue_card_title_zh, q.season,
      q.created_at        as q_created,
      (c.question_id is not null)                                      as has_card,
      c.corpus_id, c.generated_answer, c.edited_answer,
      c.box, c.due_at, c.last_reviewed_at,
      qa.analysis,
      (c.corpus_id is null)                                           as a_no_corpus,
      cor.created_at                                                  as a_batch_time,
      c.corpus_id                                                     as a_corpus_id,
      case m.match_level when 'chosen' then 0 when 'high' then 1
                         when 'mid' then 2 when 'low' then 3 else 4 end as a_match_rank,
      m.created_at                                                    as a_match_time,
      -- 已回答判定（空串视同无内容，对齐 list.ts 的 backKindOf）：卡行存在 且
      -- (有语料 或 生成卡背非空 或 用户编辑非空)。generated_answer/edited_answer 用 nullif(x,'') 挡空串。
      (c.question_id is not null
        and (c.corpus_id is not null
             or nullif(c.generated_answer, '') is not null
             or nullif(c.edited_answer, '') is not null))             as is_answered
    from public.questions q
    left join public.anki_cards c
      on c.question_id = q.id and c.user_id = p_user_id
    left join public.corpus cor
      on cor.id = c.corpus_id
    left join public.corpus_question_matches m
      on m.corpus_id = c.corpus_id and m.question_id = q.id and m.user_id = p_user_id
    left join public.question_analyses qa
      on qa.question_id = q.id and qa.season = q.season
    where q.season = p_season and q.part = p_part
  ),
  prim_f as (
    select * from prim where p_scope = 'all' or is_answered
  ),
  child as (
    select
      p3.id               as q_id,
      p3.part             as q_part,
      p3.parent_card_id   as parent_qid,
      p3.topic, p3.question_text, p3.question_text_zh,
      p3.cue_card_title, p3.cue_card_title_zh, p3.season,
      p3.created_at       as q_created,
      (c.question_id is not null)                                     as has_card,
      c.corpus_id, c.generated_answer, c.edited_answer,
      c.box, c.due_at, c.last_reviewed_at,
      qa.analysis,
      pr.a_no_corpus, pr.a_batch_time, pr.a_corpus_id,
      pr.a_match_rank, pr.a_match_time,
      pr.q_created        as parent_created,
      pr.q_id             as parent_anchor_qid,
      -- part3 恒无语料/不后台生成（0030 不变式）→ 已回答仅看 edited_answer（空串视同无内容）。
      (c.question_id is not null and nullif(c.edited_answer, '') is not null) as is_answered
    from prim_f pr
    join public.questions p3
      on p3.parent_card_id = pr.q_id and p3.part = 3 and p3.season = p_season
    left join public.anki_cards c
      on c.question_id = p3.id and c.user_id = p_user_id
    left join public.question_analyses qa
      on qa.question_id = p3.id and qa.season = p3.season
    where p_part = 2
  ),
  unioned as (
    select
      q_id, q_part, parent_qid, topic, question_text, question_text_zh,
      cue_card_title, cue_card_title_zh, season,
      corpus_id, generated_answer, edited_answer, analysis,
      box, due_at, last_reviewed_at, has_card, is_answered,
      a_no_corpus  as s_no_corpus,
      a_batch_time as s_batch_time,
      a_corpus_id  as s_corpus_id,
      a_match_rank as s_match_rank,
      a_match_time as s_match_time,
      q_created    as s_anchor_created,
      q_id         as s_anchor_qid,
      0            as s_is_child,
      q_created    as s_child_created,
      q_id         as s_child_qid
    from prim_f
    union all
    select
      q_id, q_part, parent_qid, topic, question_text, question_text_zh,
      cue_card_title, cue_card_title_zh, season,
      corpus_id, generated_answer, edited_answer, analysis,
      box, due_at, last_reviewed_at, has_card, is_answered,
      a_no_corpus, a_batch_time, a_corpus_id, a_match_rank, a_match_time,
      parent_created     as s_anchor_created,
      parent_anchor_qid  as s_anchor_qid,
      1                  as s_is_child,
      q_created          as s_child_created,
      q_id               as s_child_qid
    from child
  )
  select
    q_id, q_part, parent_qid, topic, question_text, question_text_zh,
    cue_card_title, cue_card_title_zh, season,
    corpus_id, generated_answer, edited_answer, analysis,
    coalesce(box, 1)        as box,
    coalesce(due_at, now())  as due_at,
    last_reviewed_at, has_card, is_answered
  from unioned
  order by
    s_no_corpus asc,
    s_batch_time desc nulls last,
    s_corpus_id nulls last,
    s_match_rank asc nulls last,
    s_match_time asc nulls last,
    s_anchor_created asc,
    s_anchor_qid asc,
    s_is_child asc,
    s_child_created asc,
    s_child_qid asc
$$;
