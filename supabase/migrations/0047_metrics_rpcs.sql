-- -----------------------------------------------------------------------------
-- Migration : 0047_metrics_rpcs
-- Desc      : 经营看板指标改造【阶段一·数据层】三个 RPC，与 0043/0044/0045 同批口径对齐：
--               ① get_core_active_stats     — 窗口内每天「核心活跃」注册用户去重数（形状同 0045）。
--               ② get_activation_stats      — 全量 + 窗口群组的「激活」人数（激活=corpus≥1 条）。
--               ③ get_weekly_retention_stats— 首次核心活跃群组的 W1 区间留存（D+1~D+7 任一天再活跃）。
--             三函数都须读 auth.users（JS 客户端读不到），故 security definer + search_path 含 auth。
--             ⚠️ 数据库改动，需部署方在 Supabase 控制台 SQL Editor 手动跑（形态同 0018-0023、0043-0046）：
--                本文件【不要】尝试自动跑；跑之前看板对应卡片优雅降级（RPC 缺失→route 回退旧口径/null，
--                不 500），跑之后自动切新口径。0043/0045 的现有函数【不删不改】，看板靠它们做降级回退。
--             幂等：三个 create or replace function，可安全重跑。
--
--             【共用定义·两段，三函数逐字一致复用，勿各写各的】
--             ① 真注册集（与 0043/0044/0045 完全一致，勿改）：
--                  auth.users where is_anonymous is not true and email 非空。
--                  权威源是 auth.users——不用 api_usage_logs.is_anonymous（旧 stale bug 会失真）、
--                  也不用 profiles（含匿名各一行、无法区分）。故三函数均须读 auth schema。
--             ② 核心活跃日（本次新定义）：下列信号 union all 后，按 (created_at + interval '8 hours')::date
--                折东八区日期，再 join 真注册集，取 distinct (user_id, active_day)：
--                  · AI 环节            api_usage_logs.created_at（user_id is not null）
--                  · 闪卡复习(权威)     review_events.created_at
--                  · 收藏词组           saved_phrases.created_at
--                  · 收藏单词           saved_words.created_at
--                  · 收藏发音           saved_pronunciations.created_at
--                  · 闪卡复习(历史近似) phrase_cards.last_reviewed_at（not null）
--                  · 闪卡复习(历史近似) anki_cards.last_reviewed_at（not null）
--                最后两行是 0046(review_events) 上线前的历史兜底：last_reviewed_at 只保留最后一次复习、
--                不完整，但 distinct (user_id, active_day) 去重后与 review_events 信号不会重复计数。
--                【0046 铺开一段时间、历史复习被 review_events 充分覆盖后，可评估移除这两行】。
-- Created   : 2026-07-31
-- -----------------------------------------------------------------------------


-- =============================================================================
-- 函数 1：get_core_active_stats(p_window_days int)
-- 返回窗口内【有核心活跃的天】的 (活跃日, 当日核心活跃注册用户去重数)，形状与 0045
-- get_active_registered_stats 完全一致（让看板 route 能无缝切换/降级）。
-- 语义：没活跃的天不返回，由 route 按日期轴补 0。窗口 = 活跃日落在 [今日-p_window_days, 今日]
-- （今日按东八区，对齐 0045 的今日定义）。
-- =============================================================================

-- security definer：需读 auth.users（RLS 之外的系统表），调用上下文是 service_role（看板 route）。
-- ⚠️ set search_path = public, auth, pg_temp 是提权防护 + 保证能解析 auth.users，不可省（同 0043-0045）。
create or replace function public.get_core_active_stats(p_window_days int)
returns table (day date, cnt int)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
with today as (
  -- 「今日」按东八区当天，与看板日界口径一致
  select (now() + interval '8 hours')::date as d
),
-- 【共用①】真注册集：权威来源 auth.users（非 api_usage_logs 标记、非 profiles）
registered as (
  select u.id
  from auth.users u
  where u.is_anonymous is not true
    and u.email is not null
    and btrim(u.email) <> ''
),
-- 【共用②】核心活跃日：多信号 union all 折东八区日期，join 真注册集，distinct (user_id, active_day)
active_days as (
  select distinct r.id as user_id, s.active_day
  from (
    -- AI 环节
    select user_id, (created_at + interval '8 hours')::date as active_day
      from public.api_usage_logs where user_id is not null
    union all
    -- 闪卡复习(权威)
    select user_id, (created_at + interval '8 hours')::date
      from public.review_events
    union all
    -- 收藏词组
    select user_id, (created_at + interval '8 hours')::date
      from public.saved_phrases
    union all
    -- 收藏单词
    select user_id, (created_at + interval '8 hours')::date
      from public.saved_words
    union all
    -- 收藏发音
    select user_id, (created_at + interval '8 hours')::date
      from public.saved_pronunciations
    union all
    -- 闪卡复习(历史近似)：0046 上线前兜底，只保留最后一次复习、不完整；distinct 后不重复计数
    select user_id, (last_reviewed_at + interval '8 hours')::date
      from public.phrase_cards where last_reviewed_at is not null
    union all
    -- 闪卡复习(历史近似)：同上
    select user_id, (last_reviewed_at + interval '8 hours')::date
      from public.anki_cards where last_reviewed_at is not null
  ) s
  join registered r on r.id = s.user_id
)
select a.active_day as day, count(distinct a.user_id)::int as cnt
from active_days a, today t
where a.active_day >= t.d - p_window_days
  and a.active_day <= t.d
group by a.active_day
order by a.active_day;
$$;

-- 看板 route 用 service_role 调用（绕 RLS 读各表 / auth.users）。
grant execute on function public.get_core_active_stats(int) to service_role;


-- =============================================================================
-- 函数 2：get_activation_stats(p_window_days int)
-- 返回 (registered_total, activated_total, cohort_total, cohort_activated)。
--   · 激活定义（产品方拍板，勿改）：该注册用户在 corpus 表存在 ≥1 条记录（真的讲过一次故事、
--     留下素材）。【刻意比「核心活跃」门槛更高】——只刷闪卡的用户没体验到核心价值，用宽口径
--     算激活会得到好看但无用的数，故激活只认 corpus 有记录。
--   · registered_total / activated_total：全量累计（不受窗口影响）。
--   · cohort_total / cohort_activated：注册日（auth.users.created_at 折东八区）落在
--     [今日-p_window_days, 今日] 的注册用户，及其中已激活人数。
--   · 只返回人数、不返回百分比（比例由前端算并显示 x/y）。
-- =============================================================================

-- security definer + set search_path 同上，读 auth.users 必需，不可省。
create or replace function public.get_activation_stats(p_window_days int)
returns table (registered_total int, activated_total int, cohort_total int, cohort_activated int)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
with today as (
  select (now() + interval '8 hours')::date as d
),
-- 【共用①】真注册集（此处附带注册日，口径与 0043 get_registration_stats 完全一致）
registered as (
  select u.id, (u.created_at + interval '8 hours')::date as reg_day
  from auth.users u
  where u.is_anonymous is not true
    and u.email is not null
    and btrim(u.email) <> ''
),
-- 激活用户：corpus 存在 ≥1 条记录的 user_id（去重）
activated_users as (
  select distinct c.user_id
  from public.corpus c
  where c.user_id is not null
)
select
  count(*)::int as registered_total,
  count(*) filter (where au.user_id is not null)::int as activated_total,
  count(*) filter (
    where r.reg_day >= t.d - p_window_days and r.reg_day <= t.d
  )::int as cohort_total,
  count(*) filter (
    where r.reg_day >= t.d - p_window_days and r.reg_day <= t.d
      and au.user_id is not null
  )::int as cohort_activated
from registered r
cross join today t
left join activated_users au on au.user_id = r.id;
$$;

grant execute on function public.get_activation_stats(int) to service_role;


-- =============================================================================
-- 函数 3：get_weekly_retention_stats(p_window_days int)
-- 返回 (w1_n, w1_ret, w1_rate)。
--   · 群组 = 每个注册用户的【首次核心活跃日】（用共用②的核心活跃日定义，不是注册日、
--     也不是旧 api_usage_logs 首活日）。
--   · W1 = 首活日 D0 之后的 D+1~D+7 区间内【任意一天】再次核心活跃（区间/bracket 留存，
--     不是「恰好第 7 天」）。0043 用 active_day = first_day + 7 精确等于，本函数【不沿用】。
--   · 成熟群组：首活日 ≤ 今日-7。
--   · 【回看窗口固定为 greatest(p_window_days, 30) 天，不跟随 p_window_days 缩小】。
--     原因：0043 里 first_day >= 今日-7 与成熟条件 first_day <= 今日-7 一夹，7 天视图下分母
--     坍缩成单独一天的群组、样本极窄且随机；本函数固定至少回看 30 天避免复现。
--   · 池化聚合：w1_ret = ∑回访人数，w1_n = ∑群组人数，w1_rate = round(100.0*ret/n, 1)；
--     n=0 时 rate 返回 null（诚实占位，不返回 0）。
-- =============================================================================

-- security definer + set search_path 同上，读 auth.users 必需，不可省。
create or replace function public.get_weekly_retention_stats(p_window_days int)
returns table (w1_n int, w1_ret int, w1_rate numeric)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
with today as (
  -- 「今日」按东八区当天，与看板日界口径一致
  select (now() + interval '8 hours')::date as d
),
-- 【共用①】真注册集：权威来源 auth.users（非 api_usage_logs 标记、非 profiles）
registered as (
  select u.id
  from auth.users u
  where u.is_anonymous is not true
    and u.email is not null
    and btrim(u.email) <> ''
),
-- 【共用②】核心活跃日：多信号 union all 折东八区日期，join 真注册集，distinct (user_id, active_day)
active_days as (
  select distinct r.id as user_id, s.active_day
  from (
    -- AI 环节
    select user_id, (created_at + interval '8 hours')::date as active_day
      from public.api_usage_logs where user_id is not null
    union all
    -- 闪卡复习(权威)
    select user_id, (created_at + interval '8 hours')::date
      from public.review_events
    union all
    -- 收藏词组
    select user_id, (created_at + interval '8 hours')::date
      from public.saved_phrases
    union all
    -- 收藏单词
    select user_id, (created_at + interval '8 hours')::date
      from public.saved_words
    union all
    -- 收藏发音
    select user_id, (created_at + interval '8 hours')::date
      from public.saved_pronunciations
    union all
    -- 闪卡复习(历史近似)：0046 上线前兜底，只保留最后一次复习、不完整；distinct 后不重复计数
    select user_id, (last_reviewed_at + interval '8 hours')::date
      from public.phrase_cards where last_reviewed_at is not null
    union all
    -- 闪卡复习(历史近似)：同上
    select user_id, (last_reviewed_at + interval '8 hours')::date
      from public.anki_cards where last_reviewed_at is not null
  ) s
  join registered r on r.id = s.user_id
),
-- 群组：每个注册用户的首次核心活跃日
cohorts as (
  select user_id, min(active_day) as first_day
  from active_days
  group by user_id
),
-- 是否在 D+1~D+7 区间内任意一天再次核心活跃（bracket 留存）
flags as (
  select
    c.user_id,
    c.first_day,
    exists (
      select 1 from active_days a
      where a.user_id = c.user_id
        and a.active_day between c.first_day + 1 and c.first_day + 7
    ) as returned_w1
  from cohorts c
),
-- 成熟群组：首活日 ≤ 今日-7；且首活日落在固定回看窗口 [今日-greatest(window,30), 今日]
mature as (
  select f.*
  from flags f, today t
  where f.first_day >= t.d - greatest(p_window_days, 30)
    and f.first_day <= t.d - 7
)
select
  count(*)::int as w1_n,
  count(*) filter (where returned_w1)::int as w1_ret,
  case when count(*) > 0
       then round(100.0 * count(*) filter (where returned_w1) / count(*), 1)
  end as w1_rate
from mature;
$$;

grant execute on function public.get_weekly_retention_stats(int) to service_role;
