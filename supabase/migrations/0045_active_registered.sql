-- -----------------------------------------------------------------------------
-- Migration : 0045_active_registered
-- Desc      : 经营看板两处「活跃·注册」口径的权威数据源 RPC，补齐与 0043/0044「新增注册」
--             同批的修正欠账。原口径用 api_usage_logs.is_anonymous 标记区分注册/匿名，而该标记
--             正是旧 stale JWT bug 会写错的不可靠字段，导致「今日活跃·注册 N」与趋势图「活跃人数」
--             线里的注册/匿名划分可能失真。本 RPC 改用权威源 auth.users（口径与 0043/0044 完全一致）。
--             JS 客户端读不到 auth.users，故 security definer + search_path 含 auth（同 0043/0044）。
--             ⚠️ 数据库改动，需部署方在 Supabase 控制台 SQL Editor 手动跑（形态同 0018-0023、0043、0044）：
--                本文件【不要】尝试自动跑；跑之前这两处优雅降级回退旧 is_anonymous 标记口径
--                （RPC 缺失→route 返回 null→沿用原标记计数，不 500），跑之后自动切权威口径。
--             幂等：create or replace function，可安全重跑。
--
--             get_active_registered_stats 返回窗口内【有活跃的天】的 (活跃日, 当日活跃注册去重数)。
--             口径（与 0043/0044 注册集一致、勿改）：
--               · 真注册集：auth.users where is_anonymous is not true and email 非空。
--                 【权威来源是 auth.users】——不用 api_usage_logs.is_anonymous（旧 stale bug 会失真）、
--                 也不用 profiles（含匿名各一行、无法区分）。故本函数须读 auth schema。
--               · 活跃信号：api_usage_logs 中 user_id 属于注册集的行；活跃日 =
--                 (created_at + interval '8 hours')::date（东八区，与看板日界一致）。
--               · 当日活跃注册数 = 当日活跃行里 count(distinct user_id)（同一注册真人当天多次调用只计 1）。
--               · 窗口：只返回活跃日落在 [今日-p_window_days, 今日] 的天（与看板 7/14/30 联动）。
--               · 【没活跃的天不返回】——由 route 按日期轴补 0，避免函数返回一堆 0 行。
--               · 「今日活跃·注册」由 route 从本序列取当天（活跃日=今日）那行，无该行即 0。
-- Created   : 2026-07-28
-- -----------------------------------------------------------------------------

-- security definer：需读 auth.users（RLS 之外的系统表），调用上下文是 service_role（看板 route）。
-- ⚠️ set search_path = public, auth, pg_temp 是提权防护 + 保证能解析 auth.users，不可省（同 0043/0044）。
create or replace function public.get_active_registered_stats(p_window_days int)
returns table (day date, cnt int)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
with today as (
  -- 「今日」按东八区当天，与看板日界口径一致
  select (now() + interval '8 hours')::date as d
),
-- 真注册用户集：权威来源 auth.users（非 api_usage_logs 标记、非 profiles）
registered as (
  select u.id
  from auth.users u
  where u.is_anonymous is not true
    and u.email is not null
    and btrim(u.email) <> ''
),
-- 注册用户在 api_usage_logs 的活跃行（东八区活跃日 + user_id），仅限注册集
active as (
  select
    (l.created_at + interval '8 hours')::date as active_day,
    l.user_id
  from public.api_usage_logs l
  join registered r on r.id = l.user_id
  where l.user_id is not null
)
select a.active_day as day, count(distinct a.user_id)::int as cnt
from active a, today t
where a.active_day >= t.d - p_window_days
  and a.active_day <= t.d
group by a.active_day
order by a.active_day;
$$;

-- 看板 route 用 service_role 调用（绕 RLS 读 api_usage_logs / auth.users）。
grant execute on function public.get_active_registered_stats(int) to service_role;
