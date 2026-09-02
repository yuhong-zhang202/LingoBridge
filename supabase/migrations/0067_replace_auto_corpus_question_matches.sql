-- -----------------------------------------------------------------------------
-- Migration : 0067_replace_auto_corpus_question_matches
-- Desc      : 单事务替换单条语料的自动 high/mid 反查集合，永久保留用户主动选择的 chosen；
--             同时收紧 0007 遗留的宽泛 RLS，禁止客户端伪造自动匹配。
-- Created   : 2026-09-02
-- -----------------------------------------------------------------------------

-- 产品方已明确授权：默认切换方案三时清除旧机制历史自动反查；用户主动 chosen 永久保留。
delete from public.corpus_question_matches
 where match_level <> 'chosen';

create or replace function public.replace_auto_corpus_question_matches(
  p_corpus_id uuid,
  p_matches jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if p_corpus_id is null then
    raise exception 'p_corpus_id 不能为空';
  end if;
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then
    raise exception 'p_matches 必须是 JSON 数组';
  end if;
  if jsonb_array_length(p_matches) > 349 then
    raise exception 'p_matches 最多允许 349 项';
  end if;

  -- 父行锁把同一 corpus 的自动集合替换串行化；user_id 只从父行派生，绝不相信调用方输入。
  select c.user_id
    into v_user_id
    from public.corpus c
   where c.id = p_corpus_id
   for update;
  if not found then
    raise exception 'corpus 不存在：%', p_corpus_id;
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_matches) as item(value)
     where jsonb_typeof(item.value) <> 'object'
  ) then
    raise exception 'p_matches 每项必须是对象';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_matches) as item(value)
     where (select count(*) from jsonb_object_keys(item.value)) <> 2
        or not (item.value ? 'question_id')
        or not (item.value ? 'match_level')
        or jsonb_typeof(item.value -> 'question_id') <> 'string'
        or jsonb_typeof(item.value -> 'match_level') <> 'string'
        or (item.value ->> 'match_level') not in ('high', 'mid')
        or (item.value ->> 'question_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'p_matches 只允许 question_id(UUID) 与 match_level(high/mid)';
  end if;

  if (
    select count(*) <> count(distinct (item.value ->> 'question_id')::uuid)
      from jsonb_array_elements(p_matches) as item(value)
  ) then
    raise exception 'p_matches 不允许重复 question_id';
  end if;

  -- 空数组同样执行删除，表示当前算法确认这条语料没有任何可见自动匹配。
  delete from public.corpus_question_matches
   where corpus_id = p_corpus_id
     and match_level <> 'chosen';

  insert into public.corpus_question_matches (user_id, corpus_id, question_id, match_level)
  select v_user_id,
         p_corpus_id,
         (item.value ->> 'question_id')::uuid,
         item.value ->> 'match_level'
    from jsonb_array_elements(p_matches) as item(value)
  -- 同一题已有 chosen 时必须保留用户选择；绝不把 chosen 降成自动 high/mid。
  on conflict (corpus_id, question_id) do nothing;
end;
$$;

revoke execute on function public.replace_auto_corpus_question_matches(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_auto_corpus_question_matches(uuid, jsonb)
  to service_role;

-- 0007 的 for all 策略只看可伪造的 user_id，允许客户端直接写 high/mid；改成逐动作最小权限。
drop policy if exists "own_matches_all" on public.corpus_question_matches;
drop policy if exists "own_matches_select" on public.corpus_question_matches;
drop policy if exists "own_chosen_insert" on public.corpus_question_matches;
drop policy if exists "own_chosen_update" on public.corpus_question_matches;

create policy "own_matches_select"
on public.corpus_question_matches
for select to authenticated
using ((select auth.uid()) = corpus_question_matches.user_id);

create policy "own_chosen_insert"
on public.corpus_question_matches
for insert to authenticated
with check (
  (select auth.uid()) = corpus_question_matches.user_id
  and match_level = 'chosen'
  and exists (
    select 1 from public.corpus c
     where c.id = corpus_question_matches.corpus_id
       and c.user_id = (select auth.uid())
  )
);

-- 允许客户端 upsertMatch 把本人已有的自动 high/mid 提升为 chosen；最终值绝不允许回写自动档。
create policy "own_chosen_update"
on public.corpus_question_matches
for update to authenticated
using (
  (select auth.uid()) = corpus_question_matches.user_id
  and exists (
    select 1 from public.corpus c
     where c.id = corpus_question_matches.corpus_id
       and c.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = corpus_question_matches.user_id
  and match_level = 'chosen'
  and exists (
    select 1 from public.corpus c
     where c.id = corpus_question_matches.corpus_id
       and c.user_id = (select auth.uid())
  )
);

do $$
begin
  if not has_function_privilege(
    'service_role',
    'public.replace_auto_corpus_question_matches(uuid, jsonb)',
    'execute'
  ) then
    raise exception '守卫失败：service_role 无法执行自动匹配替换 RPC，整份迁移已回滚。';
  end if;
  -- PUBLIC 若仍有授权，anon/authenticated 会继承并在这里命中，无需把 PUBLIC 当作不存在的数据库角色查询。
  if has_function_privilege(
       'anon',
       'public.replace_auto_corpus_question_matches(uuid, jsonb)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.replace_auto_corpus_question_matches(uuid, jsonb)',
       'execute'
     ) then
    raise exception '守卫失败：公开角色仍可执行自动匹配替换 RPC，整份迁移已回滚。';
  end if;
end;
$$;
