-- -----------------------------------------------------------------------------
-- Migration : 0037_swap_anki_clear_edited
-- Desc      : swap_anki_corpus 换语料时【一并清空 edited_answer】（§11 正确性红线补漏）。
--
--   为什么改：
--     0035 的 swap_anki_corpus 换语料时清了 generated_answer，却漏清 edited_answer。
--     edited_answer 是用户对【旧语料/旧生成】的逐点编辑覆盖（answer-points.ts 头注）；换语料 =
--     换了语料源、下一轮 drain 会按新语料重新生成 generated_answer，此时若 edited_answer 仍是旧覆盖，
--     旧的逐点编辑会盖住新语料的新生成（用户看到的仍是针对旧语料的过时答案）。
--     逻辑与清 generated_answer 完全同理：旧的针对旧语料的产物换语料后即失效，一并清。
--     注意仍【绝不动 box/due_at】（SRS 复习进度与语料无关，不受换语料影响）。
--
--   函数体其余部分与 0035 逐字一致，仅 on conflict do update 多一行 edited_answer = null。
--   幂等：create or replace，可安全重跑。仅由服务端 service_role 经 RPC 调用（绕 RLS），
--   不加 security definer（service_role 本就全权，与 0035 同范式），仅固定 search_path 防表名劫持。
--
--   ⚠️ 本改动动了 §11 换语料红线相关：上线前需 red-team 复审 + 真库验证「换语料后旧 edited_answer
--      确被清、下一轮 drain 按新语料生成、用户不再看到旧覆盖」。
-- Created   : 2026-07-24
-- -----------------------------------------------------------------------------

-- 换语料（单事务原子）：清卡背（generated_answer + edited_answer）+ 卡行改指新语料（懒物化则物化）+
--   在途任务改指新语料 + 兜底入队。返回卡行 id（供调用方回填/展示）。
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
  -- 卡行：懒物化下可能尚未 INSERT → upsert。首次插入按新语料建（generated_answer/edited_answer 取表默认 null）；
  -- 已存在则清空旧卡背——generated_answer + edited_answer 都清（§11 红线：旧生成与旧逐点编辑都是针对旧语料的产物，
  -- 换语料后均失效，下一轮 drain 会按新语料重新生成）+ 改指新语料，绝不动 box/due_at（复习进度与换语料无关）。
  insert into public.anki_cards (user_id, question_id, corpus_id)
    values (p_user_id, p_question_id, p_corpus_id)
    on conflict (user_id, question_id)
      do update set corpus_id        = excluded.corpus_id,
                    generated_answer = null,
                    edited_answer    = null,
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
