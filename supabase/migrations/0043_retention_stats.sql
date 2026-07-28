-- -----------------------------------------------------------------------------
-- Migration : 0043_retention_stats
-- Desc      : 经营看板两个「真注册」口径 RPC（共用同一注册集定义，权威源 auth.users）：
--               ① get_retention_stats  — 注册用户 D1 / D7 池化留存率 + 样本量（详见下方注释）。
--               ② get_registration_stats — 今日 / 窗口内【真注册】新增数，修正原看板用 profiles 计数
--                  把匿名也算进「注册」的虚高（实测 7/28 profiles 显示 13、真注册仅 3；7/26 显示 98、真注册 19）。
--             两函数都须读 auth schema（JS 客户端读不到 auth.users），故 security definer + search_path 含 auth。
--             ⚠️ 数据库改动，需部署方在 Supabase 控制台 SQL Editor 手动跑（形态同 0018-0023）：
--                本文件【不要】尝试自动跑；跑之前留存卡显「待接入」、新增注册卡回退 profiles 计数并标注「含匿名·待迁移生效」。
--             幂等：两个 create or replace function，可安全重跑。
--
-- ① get_retention_stats 返回窗口内成熟群组的池化 D1 / D7 留存率 + 样本量。
--             口径（产品方拍板、勿改）：
--               · 注册用户集：auth.users where is_anonymous is not true and email 非空。
--                 【权威来源是 auth.users】——不用 api_usage_logs.is_anonymous（旧 stale bug 会失真）、
--                 也不用 profiles（含匿名各一行、无法区分）。故本函数须读 auth schema。
--               · 活跃信号：api_usage_logs 中 user_id 属于注册集的行；活跃日 =
--                 (created_at + interval '8 hours')::date（东八区，与看板日界一致）。
--               · 群组(cohort)：每个注册用户的首次活跃日 = 其 api_usage_logs 里 min(活跃日)。
--               · D1 = 首活日=D 的用户中 D+1 也活跃的占比；池化聚合（∑回访人数 / ∑群组人数），
--                 只计已成熟群组（首活日 ≤ 今日-1）。
--               · D7 = 同理，只计首活日 ≤ 今日-7 的群组。现无成熟群组（活跃数据最早 07-22、
--                 D7=07-29>今日）→ d7_rate=null、d7_n=0，是诚实占位、非 bug，07-29 起自然有数。
--               · 窗口：只纳入首活日落在 [今日-p_window_days, 今日] 的群组（与看板 7/14/30 联动）。
--               · rate 为 0-100 百分比、保留 1 位；无成熟群组时 rate=null、n=0。
--             ⚠️ 数据库改动，需部署方在 Supabase 控制台 SQL Editor 手动跑（形态同 0018-0023）：
--                本文件【不要】尝试自动跑；跑之前看板留存卡显降级态（RPC 缺失→route 优雅降级返回 null）。
--             security definer + set search_path：需读 auth.users，写法/注释风格参照 0023。
--             幂等：create or replace function，可安全重跑。
-- Created   : 2026-07-28
-- -----------------------------------------------------------------------------

-- security definer：需读 auth.users（RLS 之外的系统表），而调用上下文是 service_role（看板 route）。
-- ⚠️ set search_path = public, auth, pg_temp 是提权防护 + 保证能解析 auth.users，不可省。
create or replace function public.get_retention_stats(p_window_days int)
returns table (d1_rate numeric, d1_n int, d7_rate numeric, d7_n int)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
with today as (
  -- 「今日」按东八区当天，与看板日界口径一致
  select (now() + interval '8 hours')::date as d
),
-- 注册用户集：权威来源 auth.users（非 api_usage_logs 标记、非 profiles）
registered as (
  select u.id
  from auth.users u
  where u.is_anonymous is not true
    and u.email is not null
    and btrim(u.email) <> ''
),
-- 注册用户在 api_usage_logs 的活跃日集合（东八区日界，去重）
active_days as (
  select distinct
    l.user_id,
    (l.created_at + interval '8 hours')::date as active_day
  from public.api_usage_logs l
  join registered r on r.id = l.user_id
  where l.user_id is not null
),
-- 群组：每个注册用户的首次活跃日
cohorts as (
  select user_id, min(active_day) as first_day
  from active_days
  group by user_id
),
-- 群组 + 是否在 D+1 / D+7 回访
flags as (
  select
    c.user_id,
    c.first_day,
    exists (
      select 1 from active_days a
      where a.user_id = c.user_id and a.active_day = c.first_day + 1
    ) as returned_d1,
    exists (
      select 1 from active_days a
      where a.user_id = c.user_id and a.active_day = c.first_day + 7
    ) as returned_d7
  from cohorts c
),
-- 窗口过滤：首活日落在 [今日-window, 今日]
windowed as (
  select f.*
  from flags f, today t
  where f.first_day >= t.d - p_window_days
    and f.first_day <= t.d
),
-- D1 成熟群组：首活日 ≤ 今日-1（D+1 已可观测）
d1 as (
  select
    count(*)::int as n,
    count(*) filter (where w.returned_d1)::int as ret
  from windowed w, today t
  where w.first_day <= t.d - 1
),
-- D7 成熟群组：首活日 ≤ 今日-7
d7 as (
  select
    count(*)::int as n,
    count(*) filter (where w.returned_d7)::int as ret
  from windowed w, today t
  where w.first_day <= t.d - 7
)
select
  case when d1.n > 0 then round(100.0 * d1.ret / d1.n, 1) end as d1_rate,
  d1.n as d1_n,
  case when d7.n > 0 then round(100.0 * d7.ret / d7.n, 1) end as d7_rate,
  d7.n as d7_n
from d1, d7;
$$;

-- 看板 route 用 service_role 调用（绕 RLS 读 api_usage_logs / auth.users）。
grant execute on function public.get_retention_stats(int) to service_role;


-- ② get_registration_stats：今日 / 窗口内【真注册】新增数。
--    真注册集与 ① 完全一致（is_anonymous is not true and email 非空）；注册时刻按 auth.users.created_at
--    折东八区当天。窗口 = [今日-p_window_days, 今日]，与看板 7/14/30 联动。
create or replace function public.get_registration_stats(p_window_days int)
returns table (today_count int, window_count int)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
with today as (
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
select
  count(*) filter (where r.reg_day = t.d)::int as today_count,
  count(*) filter (where r.reg_day >= t.d - p_window_days and r.reg_day <= t.d)::int as window_count
from regs r, today t;
$$;

grant execute on function public.get_registration_stats(int) to service_role;
