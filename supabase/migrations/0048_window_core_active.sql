-- -----------------------------------------------------------------------------
-- Migration : 0048_window_core_active
-- Desc      : 补一个「窗口去重核心活跃人数」RPC get_window_core_active —— 看板增长漏斗③主数字用。
--             背景：0047 的 get_core_active_stats 返回【每日】去重数（day, cnt），JS 侧无法跨天再去重成
--             「整个窗口内活跃过的去重人数」（按日求和会把多日活跃的人重复计数）。漏斗③要的是窗口去重
--             单值，故这里补一个只返回标量 int 的函数：与 0047 共用②【完全相同的核心活跃 7 信号 + 真注册集】，
--             只是把 distinct 收敛到 (user_id) 一维、对整个窗口计数。
--
--             【核心活跃定义与 0047 逐字一致，勿各写各的】——7 信号 union all 折东八区日期、join 真注册集：
--               AI 环节 / review_events / 收藏词组·单词·发音 / phrase_cards·anki_cards 的 last_reviewed_at(历史近似)。
--               最后两行历史兜底同 0047：0046 铺开后可评估移除。改此函数须同步对齐 0047 的信号清单。
--
--             security definer + set search_path 含 auth（读 auth.users，也是提权防护），不可省；
--             grant execute to service_role；create or replace 幂等，可安全重跑。0047/0046 现有对象不删不改。
--             ⚠️ 数据库改动，需部署方在 Supabase 控制台 SQL Editor 手动跑（形态同 0043-0047）；本文件不自动执行。
-- Created   : 2026-07-31
-- -----------------------------------------------------------------------------

create or replace function public.get_window_core_active(p_window_days int)
returns int
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with today as (
    -- 「今日」按东八区当天，与看板日界口径一致（同 0047）
    select (now() + interval '8 hours')::date as d
  ),
  -- 【共用①·与 0047/0043/0044/0045 完全一致】真注册集：权威来源 auth.users
  registered as (
    select u.id
    from auth.users u
    where u.is_anonymous is not true
      and u.email is not null
      and btrim(u.email) <> ''
  ),
  -- 【共用②·与 0047 完全一致】核心活跃日：7 信号 union all 折东八区日期，join 真注册集，distinct (user_id, active_day)
  active_days as (
    select distinct r.id as user_id, s.active_day
    from (
      select user_id, (created_at + interval '8 hours')::date as active_day
        from public.api_usage_logs where user_id is not null
      union all
      select user_id, (created_at + interval '8 hours')::date
        from public.review_events
      union all
      select user_id, (created_at + interval '8 hours')::date
        from public.saved_phrases
      union all
      select user_id, (created_at + interval '8 hours')::date
        from public.saved_words
      union all
      select user_id, (created_at + interval '8 hours')::date
        from public.saved_pronunciations
      union all
      select user_id, (last_reviewed_at + interval '8 hours')::date
        from public.phrase_cards where last_reviewed_at is not null
      union all
      select user_id, (last_reviewed_at + interval '8 hours')::date
        from public.anki_cards where last_reviewed_at is not null
    ) s
    join registered r on r.id = s.user_id
  )
  -- 窗口去重：活跃日落在 [今日-p_window_days, 今日] 的去重用户数（跨天只算一人）
  select count(distinct a.user_id)::int
  from active_days a, today t
  where a.active_day >= t.d - p_window_days
    and a.active_day <= t.d;
$$;

grant execute on function public.get_window_core_active(int) to service_role;
