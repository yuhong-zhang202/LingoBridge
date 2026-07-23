-- -----------------------------------------------------------------------------
-- Migration : 0036_anki_is_answered_pointarray
-- Desc      : get_anki_cards 的 is_answered 适配 v0.3 分点式卡背（generated_answer 从「整段 text」
--             改为「点数组 JSON 字符串」[{idx,en,noMaterial}]）。仅此一处语义修正，函数体其余部分与
--             0035 逐字一致。
--
--   为什么改（承 0035 审计 E 的一致性延续）：
--     0035 的 is_answered 主行判据是
--       (corpus_id 非空 OR nullif(generated_answer,'') 非空 OR nullif(edited_answer,'') 非空)。
--     分点式下 generated_answer 即便【全是留空点】（每个点 en=null）也是非空字符串 "[{...}]"，nullif 挡不住空串
--     以外的「空内容」，简单判非空会把「生成了但全留空」误判为「有卡背」。
--
--   正确语义（本次修正）：
--     · is_answered = 卡行存在 且 (有绑语料 OR 用户编辑非空)。【去掉 generated_answer 这一项】。
--       两条理由：
--         ① 冗余：generated_answer 只由 drain 在【已绑语料后】回填（唯一非空写入点），swap/unbind 均把
--            corpus_id 与 generated_answer 一起清空 —— 正常运行下 generated_answer 非空的行 corpus_id 必非空，
--            corpus_id 分支已覆盖之，去掉该项 answered scope 结果集不变。
--         ② 去坑（更安全）：留着该项 + 分点式 JSON「全留空也非空串」会埋假阳。尤其【已知在途竞态】
--            （processing 中删/换语料撞上生成回填，见待办「残留在途竞态」）可能瞬时造出 corpus_id=null 却
--            generated_answer 非空的行 —— 旧判据会把它误判 answered，新判据（只看 corpus/edited）此时正确判
--            未回答。去掉该项让 is_answered 在该竞态下【安全降级】，不是靠竞态被修复才成立。
--     · 「是否已回答」(is_answered) 与「渲染哪种背面」(backKind) 是两件事，本次明确解耦：
--         - is_answered：绑了语料 / 有用户编辑 = 已回答（生成是否完成、是否全留空都不影响「已回答」）；
--         - backKind（app 层 list.ts）：需要真有【可渲染的生成内容】（点数组里至少一个非留空点）才判 'generated'，
--           否则回落 'analysis'。app 层做这件事因为它要解析 JSON 点数组、判非留空点，SQL 侧不宜解析 JSON。
--       两者语义不同、互不矛盾：绑语料但生成未完成/全留空的卡 → is_answered=true（已回答）+ backKind=analysis
--       （背面暂显静态分析），完全自洽。
--     · part3 子行 is_answered 不变（part3 恒无语料/不后台生成，0030 不变式，仅看 edited_answer 空串处理）。
--
--   均只由服务端 service_role 经 RPC 调用（绕 RLS）；不加 security definer（与 0033–0035 同范式），
--   仅固定 search_path 防表名劫持。幂等：create or replace，可安全重跑。
-- Created   : 2026-07-24
-- -----------------------------------------------------------------------------

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
      -- 已回答判定（v0.3 分点式修正，见迁移头）：卡行存在 且 (有绑语料 OR 用户编辑非空)。
      -- 【不看 generated_answer】—— 分点式 JSON 全留空也非空串，且 generated 非空⟹corpus 非空（冗余）。
      (c.question_id is not null
        and (c.corpus_id is not null
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
      -- part3 恒无语料/不后台生成（0030 不变式）→ 已回答仅看 edited_answer（空串视同无内容），不变。
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
