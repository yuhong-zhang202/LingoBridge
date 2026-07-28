-- -----------------------------------------------------------------------------
-- Migration : 0044_daily_registrations
-- Desc      : 经营看板「每日参与度趋势」第三条线【每日新增注册】的数据源 RPC。
--             返回窗口内【真注册】按注册日（东八区）分天计数，与 0043 的注册口径完全一致
--             （权威源 auth.users，非 profiles——profiles 含匿名各一行会把匿名算进注册、虚高）。
--             JS 客户端读不到 auth.users，故 security definer + search_path 含 auth（同 0043）。
--             ⚠️ 数据库改动，需部署方在 Supabase 控制台 SQL Editor 手动跑（形态同 0018-0023、0043）：
--                本文件【不要】尝试自动跑；跑之前趋势图该线优雅降级不渲染（RPC 缺失→route 返回 null、
--                前端只画原「活跃人数 + 练习场次」两条），跑之后第三条线自动出现。
--             幂等：create or replace function，可安全重跑。
--
--             get_daily_registrations 返回窗口内【有注册的天】的 (注册日, 当日真注册数)。
--             口径（与 0043 get_registration_stats 一致、勿改）：
--               · 真注册集：auth.users where is_anonymous is not true and email 非空。
--               · 注册日：(created_at + interval '8 hours')::date（东八区，与看板日界一致）。
--               · 窗口：只返回注册日落在 [今日-p_window_days, 今日] 的天（与看板 7/14/30 联动）。
--               · 【没注册的天不返回】——由 route 按日期轴补 0，避免函数返回一堆 0 行。
-- Created   : 2026-07-28
-- -----------------------------------------------------------------------------

-- security definer：需读 auth.users（RLS 之外的系统表），调用上下文是 service_role（看板 route）。
-- ⚠️ set search_path = public, auth, pg_temp 是提权防护 + 保证能解析 auth.users，不可省（同 0043）。
create or replace function public.get_daily_registrations(p_window_days int)
returns table (reg_day date, cnt int)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
with today as (
  -- 「今日」按东八区当天，与看板日界口径一致
  select (now() + interval '8 hours')::date as d
),
-- 真注册用户的注册日（东八区）。权威源 auth.users，非 profiles（含匿名各一行、虚高）。
regs as (
  select (u.created_at + interval '8 hours')::date as reg_day
  from auth.users u
  where u.is_anonymous is not true
    and u.email is not null
    and btrim(u.email) <> ''
)
select r.reg_day, count(*)::int as cnt
from regs r, today t
where r.reg_day >= t.d - p_window_days
  and r.reg_day <= t.d
group by r.reg_day
order by r.reg_day;
$$;

-- 看板 route 用 service_role 调用（绕 RLS 读 auth.users）。
grant execute on function public.get_daily_registrations(int) to service_role;
