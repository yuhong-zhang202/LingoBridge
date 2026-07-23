-- -----------------------------------------------------------------------------
-- Migration : 0033_anki_pipeline_rpcs
-- Desc      : Anki 卡背生成流水线的两个 DB 侧 RPC —— 入队（enqueue）与领取（claim）。
--             这两步都无法用 supabase-js 单条调用安全表达，必须落在 plpgsql 里，故独立成迁移：
--
--   ① enqueue_anki_generation：存对子时【原子】upsert 卡行 + 入队一条生成任务。
--      入队走 `on conflict do nothing` 兜 0031 的部分唯一索引 anki_gen_jobs_active_uidx
--      （同 (user_id, question_id) 至多一条未完成任务）——PostgREST 无法对【带谓词的部分索引】
--      表达 ON CONFLICT ... WHERE，只能在 plpgsql 里显式写谓词，故必须落库函数。
--      卡行 upsert 只更新 corpus_id/updated_at，绝不动 box/due_at/generated_answer/edited_answer
--      （懒物化的复习进度与已生成内容不能被重新入队清掉）。
--
--   ② claim_anki_generation_jobs：drain worker 用 `FOR UPDATE SKIP LOCKED` 批量领取 pending
--      且 next_attempt_at <= now() 的任务，领取即置 processing、attempts+1。SKIP LOCKED 让多 worker
--      并发不抢同一单；此路径正由 0031 的 anki_gen_jobs_claim_idx (status, next_attempt_at) 服务。
--      supabase-js 无法表达 FOR UPDATE SKIP LOCKED，故必须落库函数。
--
--   均只由服务端 service_role 经 RPC 调用（绕 RLS）；不加 security definer——service_role 本就全权，
--   与 0015 bump_daily_usage 同范式，仅固定 search_path 防表名劫持。
--
--   幂等：create or replace function，可安全重跑。
-- Created   : 2026-07-23
-- -----------------------------------------------------------------------------

-- ① 入队：原子 upsert 卡行 + 入队生成任务，返回卡行 id（供调用方回填/展示）。
create or replace function public.enqueue_anki_generation(
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
  -- 懒物化卡行：首次 INSERT；已存在则只把 corpus_id 换成本次对子的语料，不碰复习进度与已生成内容。
  insert into public.anki_cards (user_id, question_id, corpus_id)
    values (p_user_id, p_question_id, p_corpus_id)
    on conflict (user_id, question_id)
      do update set corpus_id = excluded.corpus_id, updated_at = now()
    returning id into v_card_id;

  -- 入队一条生成任务；命中「同题已有未完成任务」的部分唯一索引则什么都不做（防重复入队）。
  insert into public.anki_generation_jobs (user_id, question_id, card_id, corpus_id)
    values (p_user_id, p_question_id, v_card_id, p_corpus_id)
    on conflict (user_id, question_id)
      where status in ('pending', 'processing')
      do nothing;

  return v_card_id;
end;
$$;

-- ② 领取：批量领 pending 且到点的任务，置 processing、attempts+1，返回被领取的整行。
create or replace function public.claim_anki_generation_jobs(p_limit int)
returns setof public.anki_generation_jobs
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return query
  update public.anki_generation_jobs j
     set status          = 'processing',
         attempts        = j.attempts + 1,
         updated_at       = now()
   where j.id in (
     select c.id
       from public.anki_generation_jobs c
      where c.status = 'pending'
        and c.next_attempt_at <= now()
      order by c.next_attempt_at
      for update skip locked
      limit p_limit
   )
  returning j.*;
end;
$$;
