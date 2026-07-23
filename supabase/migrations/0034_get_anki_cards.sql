-- -----------------------------------------------------------------------------
-- Migration : 0034_get_anki_cards
-- Desc      : Anki 卡列表读取 RPC —— 按「当季 + part」列出某用户的题卡，无卡的题回默认卡值，
--             part2 卡带其 part3 子题成组，并按「语料批次相邻 → 无语料在后」排序（方案 §5/§6）。
--
--   为什么落库函数（而非应用层多次查询 + JS 排序）：
--     · 「主行 + 子行（part3）成组 + 按父卡锚点排序」跨表、跨行，PostgREST 无法一次表达；
--     · LEFT JOIN 后对无卡行给默认值（box=1/due=now）也须在 SQL 里 coalesce，避免 N+1。
--     · 与 0033 的 anki 流水线 RPC 同置，读写两侧都收敛在 DB 函数里。
--
--   语义（方案 §5）：
--     ① 集合 = questions(season=p_season, part=p_part) LEFT JOIN anki_cards(当前 user)。
--        无卡的题 = 默认卡：box=1、due=now、corpus/generated/edited 均 null、背面走分析。
--     ② season 过滤：季度由应用层常量 CURRENT_SEASON 传入 p_season（单一真源在 src/lib/constants.ts，
--        RPC 不写死季度），只召回当季题；过季题不进列表（与召回/切换池同口径）。
--     ③ scope：
--          'all'      = 当季该 part 全部题（每题一张卡，未物化的按默认卡展示）；
--          'answered' = 只留「已回答」的主行。已回答判定 = 卡行存在 且
--                       (corpus_id 非空 或 generated_answer 非空 或 edited_answer 非空)。
--          part3 子行始终随其被纳入的 part2 父行成组展示，不独立参与 scope 过滤
--          （part3 是 part2 的追问、作复习组的一部分；part3 自身「已回答」判定仅看 edited_answer，
--           因 part3 恒无语料/不后台生成，见 0030 不变式）。
--     ④ 排序（方案 §5）：
--          有语料的卡在前、无语料的在后；有语料段内按 corpus 批次聚拢（同 corpus 相邻），
--          批次间按 corpus.created_at 新→旧；批次内按「近似匹配页序」；part2 卡后紧跟其 part3 子题。
--          ⚠ 「近似匹配页序」本轮不引入 corpus_question_matches.display_index（方案 §5 标为可选增强），
--             用现有可得字段近似：match_level 档位（chosen>high>mid>low）→ 匹配行 created_at → 题创建序。
--             与「用户在匹配页看到的真实顺序」可能有出入，属已知近似（TODO：后续加 display_index 精确化）。
--
--   越权防护（对齐 0033 / 0015 范式，不加 security definer）：
--     本 RPC 只经服务端 service_role 调用（端点已 requireUser 反查 userId 后作 p_user_id 传入），
--     对 anki_cards / corpus / corpus_question_matches 一律显式按 p_user_id 过滤；questions /
--     question_analyses 为公开引用数据（无 RLS）。service_role 本就全权，仅固定 search_path 防表名劫持。
--
--   幂等：create or replace function，可安全重跑。
-- Created   : 2026-07-23
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
  parent_question_id uuid,        -- part3 → 其 part2 题 id（questions.parent_card_id）；part1/2 为 null
  topic              text,
  question_text      text,
  question_text_zh   text,
  cue_card_title     text,
  cue_card_title_zh  text,
  season             text,
  corpus_id          uuid,        -- 卡绑定的语料；null = 无语料/默认卡/part3（背面走分析）
  generated_answer   text,        -- 后台生成的卡背（未生成/无语料时 null）
  edited_answer      text,        -- 用户编辑覆盖（优先级最高）
  analysis           jsonb,       -- 该题当季静态分析（question_analyses，无则 null）
  box                int,         -- Leitner 盒子（默认卡回 1）
  due_at             timestamptz, -- 下次到期（默认卡回 now）
  last_reviewed_at   timestamptz, -- 上次复习（未复习/默认卡为 null）
  has_card           boolean,     -- 卡行是否已物化（false = 默认卡，字段为 coalesce 出的默认值）
  is_answered        boolean      -- 是否已回答（scope 过滤依据，也回给展示层）
)
language sql
stable
set search_path = public, pg_temp
as $$
  with prim as (
    -- 当季目标 part 的主行（part1 或 part2）LEFT JOIN 当前用户的卡 + 语料 + 匹配行 + 分析。
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
      -- 排序锚点（本主行用自身语料/匹配态）
      (c.corpus_id is null)                                           as a_no_corpus,
      cor.created_at                                                  as a_batch_time,
      c.corpus_id                                                     as a_corpus_id,
      case m.match_level when 'chosen' then 0 when 'high' then 1
                         when 'mid' then 2 when 'low' then 3 else 4 end as a_match_rank,
      m.created_at                                                    as a_match_time,
      (c.question_id is not null
        and (c.corpus_id is not null
             or c.generated_answer is not null
             or c.edited_answer is not null))                         as is_answered
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
    -- scope 过滤只作用于主行；'all' 全留，'answered' 只留已回答。
    select * from prim where p_scope = 'all' or is_answered
  ),
  child as (
    -- part3 子行：仅 p_part=2 时纳入；随被保留的 part2 父行成组，用父行锚点排序。
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
      -- part3 恒无语料/不后台生成（0030 不变式）→ 已回答仅看 edited_answer。
      (c.question_id is not null and c.edited_answer is not null)     as is_answered
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
    -- 主行：用自身锚点，s_is_child=0 排在其 part3 子行之前。
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
    -- part3 子行：用父卡锚点，s_is_child=1 紧跟父卡；组内按 part3 创建序。
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
    coalesce(box, 1)        as box,        -- 默认卡回 box1
    coalesce(due_at, now())  as due_at,     -- 默认卡回 now（到期即可复习）
    last_reviewed_at, has_card, is_answered
  from unioned
  order by
    s_no_corpus asc,               -- 有语料（false）在前、无语料（true）在后
    s_batch_time desc nulls last,  -- 语料批次按 corpus.created_at 新→旧（对齐 corpus 列表新→旧）
    s_corpus_id nulls last,        -- 同批次（同 corpus）相邻，防同 created_at 交错
    s_match_rank asc nulls last,   -- 批次内近似匹配页序（chosen>high>mid>low）
    s_match_time asc nulls last,   -- 同档按匹配行创建序
    s_anchor_created asc,          -- 无语料段排序 + 最终 tiebreak：题创建序
    s_anchor_qid asc,              -- 稳定 tiebreak，保持主行与其子行成组
    s_is_child asc,                -- 主行在其 part3 子行之前
    s_child_created asc,           -- 组内 part3 按创建序
    s_child_qid asc
$$;
