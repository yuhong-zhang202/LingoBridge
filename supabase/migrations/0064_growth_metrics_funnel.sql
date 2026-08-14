-- -----------------------------------------------------------------------------
-- Migration : 0064_growth_metrics_funnel
-- Desc      : 产品增长指标【第一批·主线漏斗侧】四个只读 RPC：
--               ⓪ get_core_active_user_days  — 共用底座：注册用户的（user_id, 核心活跃日）全集。
--               ① get_growth_funnel          — 七步主线漏斗各步去重人数。
--               ② get_funnel_browse_only     — 漏斗注脚①：只浏览未动手的注册用户数（同人群集合差）。
--               ③ get_quota_wall_stats       — 额度墙：撞墙人数 / 撞墙后 7 天内注册 / 撞墙后 7 天内沉默。
--
--   ⚠️⚠️【口径与 0047 那批增长指标【刻意不一致】，不可互相对照】
--     本文件所有函数【剔除内部账户（调用方传 p_exclude_user_ids）与 is_qa 自测流量】；
--     而 0047 的 get_core_active_stats / get_activation_stats / get_weekly_retention_stats
--     【两者都不剔】。故本批的人数与 0047 那批的人数【不可直接相减、不可当同一口径对比】——
--     差值既不是「自测量」也不是「内部账户量」，而是两套口径的混合差。每个函数下方逐一重申。
--
--   ⚠️【is_qa 只存在于 flow_events 与 api_usage_logs 两张表】（0053 / 0059）。
--     consent_records / corpus / practice_sessions / review_events / saved_* 都没有这一列，
--     只能剔内部账户。⇒ 产品方用无痕模式（每次一个全新匿名 user_id，进不了内部名册）自测时，
--     那几张表的行【剔不掉】。后果是方向已知的系统性偏差：漏斗第 1/3/6 步相对第 2/4/5/7 步
--     偏高。这不是 bug，是当前埋点能力的边界，读数时必须知道。
--
--   ⚠️【窗口口径逐字沿用 0047：闭区间 [今日-p_window_days, 今日]】
--     即实际覆盖 p_window_days + 1 个日历日，比应用层的 rangeStartDate（恰好 p_window_days 天，
--     见 api/dashboard/route.ts）多一天。刻意与 0047 对齐而不与应用层对齐：本批函数会和
--     0043-0048 那批摆在同一块看板上，SQL 侧两套窗口写法互不相同才是真的会害人。
--     ⇒ 本批 RPC 的数与主看板按 range 算出来的数【差一天的量】，不可直接相减。
--
--   ⚠️【日界折算逐字沿用 0047：(ts + interval '8 hours')::date】
--     该写法依赖数据库 TimeZone = UTC（Supabase 默认值）—— timestamptz::date 用的是会话时区。
--     0047/0044/0045 全是这个写法，本批保持一致；若哪天运维改了库的 default TimeZone，
--     这一整批（含 0043-0048）会一起错，是一处集中的、可一次性修的依赖，不是本批新引入的风险。
--     代价：该表达式不可走 created_at 索引（函数式过滤），当前数据量（万级）可接受；
--     真到需要时的正解是加表达式索引，不是把日界改成半开区间。
--
--   【内部账户名册为什么走参数而不写死在 SQL】INTERNAL_ACCOUNT_IDS 的唯一真源是
--     src/lib/internal-accounts.ts（client/server 两用）。在 SQL 里再抄一份 = 两处会各自漂移，
--     且改名册要跑迁移。范式逐字照抄 0063_global_ai_cost_today。
--
--   【权限】每个函数都【自带 revoke】——这是 0052 hotfix 的直接教训：PG 对新建函数默认
--     GRANT EXECUTE TO PUBLIC，Supabase 的 default privileges 又额外给 anon=X / authenticated=X，
--     而 0043-0048 那批只写 grant 不写 revoke，结果 8 个经营指标 RPC 全部可被匿名 key 直读
--     （2026-08-02 生产实测 8/8 返回 200）。0052 顶注原话：「任何新增 security definer 函数，
--     必须【自带 revoke】——不要照抄 0043-0048 那批只写 grant 的旧范式」。本文件逐个成对写。
--
--   幂等：create or replace function + revoke/grant，可安全重跑。
--   ⚠️ 用 npm run db:push 应用（推 main 时 .github/workflows/db-push.yml 自动执行）。
--      db-push 已按文件包 BEGIN/COMMIT，本文件【不自带 begin/commit】（自带会造成嵌套事务，
--      使守卫失去回滚保护，理由见 0052 顶注）。
-- Created   : 2026-08-14
-- -----------------------------------------------------------------------------


-- =============================================================================
-- 函数 ⓪：get_core_active_user_days(p_exclude_user_ids uuid[])
-- 共用底座 —— 返回【真注册用户】的 (user_id, 核心活跃日) 去重全集（不限时间窗）。
--
-- 【为什么单独抽出来】0047 把「核心活跃日」那段 union all 在两个函数里各抄了一遍，本批还要再用
-- 四次（浏览未动手 / W1 序列 / 粘性 / 分层）。抄六遍必然漂移 —— 而漂移的表现是「两张卡上的
-- 活跃人数差 1」，没人能一眼看出是哪一份抄错了。故收敛成一个函数，本批全部调它。
--
-- 【与 0047 共用②的差异 —— 只有两处，其余逐字相同】
--   · 剔内部账户（p_exclude_user_ids）；
--   · api_usage_logs 剔 is_qa（0059 口径 `is_qa is not true`，NULL 行保留：那是加列前的历史行，
--     宁可少剔绝不错剔）。其余六个信号源没有 is_qa 列，剔不掉。
--   ⇒ 本函数的人数【必然 ≤】0047 的口径，且差额不可解释为「自测量」，不要与 0047 相减。
--
-- 【不限时间窗是刻意的】调用方要的窗口互不相同：W1 序列要按人取【全历史首活日】，
-- 粘性的 MAU 要回看窗口起点之前 29 天。给一个窗口参数只会让每个调用方各自算偏移、各错一次。
-- 代价是全表扫描 —— 当前数据量（万级）可接受；真到需要时把窗口下推成第二个参数即可。
--
-- 【为什么多返 has_ai / has_other 两个布尔】0065 的「核心活跃人数拆分」要回答「核心活跃 18 人
-- 里混了谁」，即把 7 个信号拆成【AI 主线(api_usage_logs)】与【沉淀/复习(其余 6 个)】两侧。
-- 若不在这里带出来，调用方就得把那段 union all【再抄一遍】只为判断信号来源 —— 而本函数存在的
-- 全部理由就是不让那段被抄第 N 遍。两个布尔按 (user_id, active_day) 聚合，
-- 【每个 (user_id, active_day) 仍恰好一行】，调用方按原来的方式 count distinct 不受影响。
-- =============================================================================

-- security definer：必须读 auth.users（真注册集的权威源，JS 客户端与普通角色都读不到）。
-- ⚠️ set search_path = public, auth, pg_temp 既是提权防护、也是解析 auth.users 的前提，不可省（同 0047）。
-- ⚠️ 函数体内所有列引用【一律带表别名】：returns table 的输出列名（user_id / active_day）在
--    language sql 函数体里同时是形参名，裸写会撞成 ambiguous reference。
create or replace function public.get_core_active_user_days(
  p_exclude_user_ids uuid[] default '{}'
)
returns table (user_id uuid, active_day date, has_ai boolean, has_other boolean)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
-- 真注册集：口径与 0043/0044/0045/0047 完全一致（非匿名 + 有邮箱），权威源 auth.users。
-- 刻意不用 api_usage_logs.is_anonymous（旧 stale JWT bug 会写错）、也不用 profiles（含匿名各一行）。
with registered as (
  select u.id
  from auth.users u
  where u.is_anonymous is not true
    and u.email is not null
    and btrim(u.email) <> ''
    -- 内部账户排除（名册由调用方传入，见文件头）
    and not (u.id = any(coalesce(p_exclude_user_ids, '{}'::uuid[])))
)
select s.uid, s.day, bool_or(s.is_ai), bool_or(not s.is_ai)
from (
  -- AI 环节（唯一带 is_qa 的信号源，0059）—— 这一支即「AI 主线」侧
  select l.user_id as uid, (l.created_at + interval '8 hours')::date as day, true as is_ai
    from public.api_usage_logs l
   where l.user_id is not null
     and l.is_qa is not true
  union all
  -- 闪卡复习(权威，0046)
  select e.user_id, (e.created_at + interval '8 hours')::date, false
    from public.review_events e
  union all
  -- 收藏词组
  select p.user_id, (p.created_at + interval '8 hours')::date, false
    from public.saved_phrases p
  union all
  -- 收藏单词
  select w.user_id, (w.created_at + interval '8 hours')::date, false
    from public.saved_words w
  union all
  -- 收藏发音
  select n.user_id, (n.created_at + interval '8 hours')::date, false
    from public.saved_pronunciations n
  union all
  -- 闪卡复习(历史近似)：0046 上线前的兜底，只保留最后一次复习、不完整；聚合后不重复计数
  select c.user_id, (c.last_reviewed_at + interval '8 hours')::date, false
    from public.phrase_cards c where c.last_reviewed_at is not null
  union all
  -- 闪卡复习(历史近似)：同上
  select a.user_id, (a.last_reviewed_at + interval '8 hours')::date, false
    from public.anki_cards a where a.last_reviewed_at is not null
) s
join registered r on r.id = s.uid
group by s.uid, s.day;
$$;

revoke execute on function public.get_core_active_user_days(uuid[]) from public, anon, authenticated;
grant  execute on function public.get_core_active_user_days(uuid[]) to service_role;


-- =============================================================================
-- 函数 ①：get_growth_funnel(p_window_days int, p_exclude_user_ids uuid[])
-- 七步主线漏斗，每步返回窗口内的【去重 user_id 人数】。
-- 人群 = 所有建过号的 user_id（含匿名），刻意【不】限定真注册集 —— 漏斗要看的正是
-- 「匿名试用的人走到哪一步」，只算注册用户会把第 1~4 步整体砍掉一大截。
--
-- 【七步与其口径】
--   1 signup            建号        consent_records 窗口内新增（按 agreed_at，本表没有 created_at）
--   2 story_told        讲故事      flow.capture_submitted 且 props.outcome='proceed'
--   3 corpus_built      语料建成    corpus 窗口内新增行
--   4 matched           匹配到题    match.view_rendered 且 props.noMatch ≠ true
--   5 question_opened   打开题目    match.question_opened
--   6 practice_started  开始练习    practice_sessions 窗口内新增
--   7 feedback_card     拿到反馈卡  flow.practice_ended
--
-- ⚠️⚠️【三个必须随数字一起读的口径陷阱】
--   · 第 1 步不是精确 UV。consent_records 记的是「点了同意并开始」，≈ 全新访客的近似
--     （page.view 在首页那一格因为还没有 session 而系统性发不出去，见 event-schema 的 PAGE_ROUTE
--     注释，故不能拿 page.view 当分母）。它既漏掉「进来看一眼就走、没点同意」的人，
--     也会把同一真人的多个匿名 id 各算一次。⇒ 只可当趋势看，不可当访客总量。
--   · 第 7 步系统性偏低。flow.practice_ended 只在用户【主动点结束】时上报，关标签页 / 地址栏跳走
--     不会有这条（与 flow.capture_abandoned 同源的卸载丢失，见 event-schema 该条目）。
--     ⇒ 它计的是「主动结束的场次的人」，【不可当练习完成总量】，第 6→7 的落差里含一截纯埋点缺口。
--   · 【流失一律用相邻两级差值推断】。严禁拿 flow.capture_abandoned 当任何比率的分子 ——
--     它的丢失概率与「用户怎么离开」强相关（站内跳走实测 3/3 到、关标签页实测 0/8），
--     方向已知、大小未知、改代码消不掉，算出来的放弃率会系统性低估且【不可校正】。
--
-- ⚠️ 剔除口径见文件头：flow_events 那四步（2/4/5/7）剔 is_qa + 内部账户；
--    consent_records / corpus / practice_sessions 三步（1/3/6）只剔得掉内部账户 ⇒ 相对偏高。
-- ⚠️ 与 0047 那批口径不一致（0047 两者都不剔），二者的人数不可直接相减或对比。
--
-- 返回：每步一行（含人数为 0 的步，靠 steps 目录左连接保证 —— 缺一行会让前端的下标错位，
--       而「某一步为 0」恰恰是最需要被看见的信号）。转化率与「掉幅最大那一级」由调用方算
--       （见 src/lib/db/dashboard-growth.ts 的 deriveFunnelSteps：除零与四舍五入在 TS 侧统一处理、可单测）。
-- =============================================================================

-- invoker（刻意不标 security definer）：本函数不读 auth.users，只读业务表。
-- 业务表全部启用了 RLS 且无 select 策略（flow_events 0018 / corpus 0001 / practice_sessions 0016 /
-- consent_records 0022 只有 select-own），故 anon 即使能执行也读不到行 —— 与 0063 同一条纪律：
-- 收权是给「将来有人图省事改成 security definer」上的保险。
create or replace function public.get_growth_funnel(
  p_window_days int,
  p_exclude_user_ids uuid[] default '{}'
)
returns table (step_index int, step_key text, users int)
language sql
stable
as $$
with today as (
  -- 「今日」按东八区当天，与 0047/0044/0045 的日界口径一致
  select (now() + interval '8 hours')::date as d
),
bounds as (
  -- 闭区间 [今日-p_window_days, 今日]，逐字沿用 0047（见文件头「窗口口径」）
  select t.d - p_window_days as from_day, t.d as to_day from today t
),
-- 步骤目录：保证 0 人的步也占一行（left join 的右表）
steps(step_index, step_key) as (
  values (1::int, 'signup'::text), (2, 'story_told'), (3, 'corpus_built'), (4, 'matched'),
         (5, 'question_opened'), (6, 'practice_started'), (7, 'feedback_card')
),
excluded as (
  select coalesce(p_exclude_user_ids, '{}'::uuid[]) as ids
),
signals as (
  -- 1 建号：consent_records 的时间列是 agreed_at（本表刻意没有 created_at，见 0022）
  select 1 as step_index, c.user_id
    from public.consent_records c, bounds b, excluded x
   where (c.agreed_at + interval '8 hours')::date between b.from_day and b.to_day
     and not (c.user_id = any(x.ids))
  union all
  -- 2 讲故事：采集提交且放行（被各类闸挡下的 outcome 不算「讲了故事」）
  select 2, f.user_id
    from public.flow_events f, bounds b, excluded x
   where f.event = 'flow.capture_submitted'
     and f.props->>'outcome' = 'proceed'
     and f.is_qa is not true
     and f.user_id is not null
     and not (f.user_id = any(x.ids))
     and (f.created_at + interval '8 hours')::date between b.from_day and b.to_day
  union all
  -- 3 语料建成：corpus 是服务端事实（不是埋点），比第 2 步可靠
  select 3, c.user_id
    from public.corpus c, bounds b, excluded x
   where (c.created_at + interval '8 hours')::date between b.from_day and b.to_day
     and not (c.user_id = any(x.ids))
  union all
  -- 4 匹配到题：noMatch ≠ true。用 `is distinct from 'true'` 而非 `<> 'true'`——
  --   props 里没带 noMatch 的行（多数成功匹配都不带）在 `<>` 下求值为 NULL、会被整行滤掉。
  select 4, f.user_id
    from public.flow_events f, bounds b, excluded x
   where f.event = 'match.view_rendered'
     and (f.props->>'noMatch') is distinct from 'true'
     and f.is_qa is not true
     and f.user_id is not null
     and not (f.user_id = any(x.ids))
     and (f.created_at + interval '8 hours')::date between b.from_day and b.to_day
  union all
  -- 5 打开题目
  select 5, f.user_id
    from public.flow_events f, bounds b, excluded x
   where f.event = 'match.question_opened'
     and f.is_qa is not true
     and f.user_id is not null
     and not (f.user_id = any(x.ids))
     and (f.created_at + interval '8 hours')::date between b.from_day and b.to_day
  union all
  -- 6 开始练习：practice_sessions 是服务端事实
  select 6, p.user_id
    from public.practice_sessions p, bounds b, excluded x
   where (p.created_at + interval '8 hours')::date between b.from_day and b.to_day
     and not (p.user_id = any(x.ids))
  union all
  -- 7 拿到反馈卡：只记主动点「结束」，系统性偏低（见上方口径陷阱）
  select 7, f.user_id
    from public.flow_events f, bounds b, excluded x
   where f.event = 'flow.practice_ended'
     and f.is_qa is not true
     and f.user_id is not null
     and not (f.user_id = any(x.ids))
     and (f.created_at + interval '8 hours')::date between b.from_day and b.to_day
)
select s.step_index, s.step_key, count(distinct g.user_id)::int as users
from steps s
left join signals g on g.step_index = s.step_index
group by s.step_index, s.step_key
order by s.step_index;
$$;

revoke execute on function public.get_growth_funnel(int, uuid[]) from public, anon, authenticated;
grant  execute on function public.get_growth_funnel(int, uuid[]) to service_role;


-- =============================================================================
-- 函数 ②：get_funnel_browse_only(p_window_days int, p_exclude_user_ids uuid[])
-- 漏斗注脚①（挂在第 1 步）：【只浏览未动手的注册用户数】。
--
-- 🔴【必须是同一人群的集合差，不是两个不同人群相减】
--   = (注册用户中，窗口内有 page.view 的去重集合)  减去  (窗口内核心活跃集合)
--   两个集合都限定在【同一个真注册集】上，再做 EXCEPT。
--   若写成「有 page.view 的人数 − 核心活跃人数」两个标量相减，结果可以是负数、也可以在
--   两边人根本不重叠时给出一个完全没有意义的差 —— 那不是同一批人。这里用 except 做真集合差。
--
-- 返回三个数（都要给前端，才解释得清这个差是怎么来的）：
--   page_view_users   窗口内有 page.view 的注册用户数
--   core_active_users 窗口内核心活跃的注册用户数（本批口径，非 0047 口径）
--   browse_only_users 前者减去后者（真集合差）
--
-- ⚠️ page.view 自身有已知缺口：全新访客落地首页时还没有 supabase session，那条 page.view
--    发不出去且不会补发（见 event-schema 的 PAGE_ROUTE 注释）。对本指标影响有限
--    （分子限定在【注册用户】上，注册用户必然已有 session），但仍会漏掉「注册前那一段的浏览」。
-- ⚠️ 本函数剔除内部账户与 is_qa，与 0047 的增长指标口径不一致（0047 两者都不剔），
--    二者的人数不可直接相减或对比。
-- =============================================================================

-- security definer + search_path：需要读 auth.users 定真注册集（同 ⓪，不可省）。
create or replace function public.get_funnel_browse_only(
  p_window_days int,
  p_exclude_user_ids uuid[] default '{}'
)
returns table (page_view_users int, core_active_users int, browse_only_users int)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
with today as (
  select (now() + interval '8 hours')::date as d
),
bounds as (
  select t.d - p_window_days as from_day, t.d as to_day from today t
),
registered as (
  select u.id
  from auth.users u
  where u.is_anonymous is not true
    and u.email is not null
    and btrim(u.email) <> ''
    and not (u.id = any(coalesce(p_exclude_user_ids, '{}'::uuid[])))
),
-- 集合 A：注册用户里，窗口内有过 page.view 的人
pv as (
  select distinct f.user_id as id
  from public.flow_events f
  join registered r on r.id = f.user_id
  cross join bounds b
  where f.event = 'page.view'
    and f.is_qa is not true
    and (f.created_at + interval '8 hours')::date between b.from_day and b.to_day
),
-- 集合 B：同一批注册用户里，窗口内核心活跃的人（复用 ⓪，口径只此一份）
core as (
  select distinct d.user_id as id
  from public.get_core_active_user_days(p_exclude_user_ids) d
  cross join bounds b
  where d.active_day between b.from_day and b.to_day
),
-- 真集合差：A 中不在 B 里的人（不是两个人数相减）
only_browse as (
  select id from pv
  except
  select id from core
)
select
  (select count(*) from pv)::int          as page_view_users,
  (select count(*) from core)::int        as core_active_users,
  (select count(*) from only_browse)::int as browse_only_users;
$$;

revoke execute on function public.get_funnel_browse_only(int, uuid[]) from public, anon, authenticated;
grant  execute on function public.get_funnel_browse_only(int, uuid[]) to service_role;


-- =============================================================================
-- 函数 ③：get_quota_wall_stats(p_exclude_user_ids uuid[])
-- 额度墙：撞墙人数 + 撞墙后 7 天内注册 + 撞墙后 7 天内沉默（撞墙窗口 30 天，观察期 7 天）。
--
-- 【口径锁死（产品方拍板，不得更改）】
--   · 撞墙人群 = 近 30 天内（东八区闭区间 [今日-30, 今日]）发生过 quota.reached 且
--     props.variant='trial' 的去重 user_id。同一人多次撞墙时，锚点取【首次】撞墙时刻
--     （min(created_at)）—— 「撞墙之后发生了什么」这句话里的「之后」只能有一个起点。
--   · 转化 = 该人在【锚点之后 7×24 小时内】出现过 auth.registered。
--   · 沉默 = 该人在【锚点之后 7×24 小时内】没有任何一条 flow_events。
--
-- 🔴【quota.cta='close' 绝不可作为「被劝退」的证据 —— 这是本函数存在的理由】
--   关闭是关掉弹层的唯一方式（点遮罩 / Esc 都记 close），它是必然动作、不是意愿信号。
--   拿 close 的占比当「吓走了多少人」，得到的会是一个接近 100% 的、永远不会变的数。
--   判据只能是撞墙【之后】的真实行为：注册了（转化）/ 什么都没做（沉默）/ 继续用（既不转化也不沉默）。
--
-- ⚠️【观察期未满 = 两个率被系统性拉低，读数时必须先看 mature_users】
--   撞墙窗口 30 天、观察期 7 天 ⇒ 只有【最近 7 天】撞墙的人观察期没走完，其余全部成熟。
--   昨天撞墙的人只走完 1/7 的观察期，他后面 6 天里注册或活动都不会被算进来。
--   故额外返回 mature_users（撞墙时刻已满 7×24 小时的人数）：
--   mature_users ≪ wall_users 时，转化率/沉默率都还没定型，别当结论用。
--
-- 【为什么撞墙窗口取 30 天而不是 7 天（产品方 2026-08-14 拍板，改前请先读完本段）】
--   初版两个窗口都取 7 天，结果是【平均只走完一半观察期】：今天撞墙的人观察期为 0，
--   7 天前撞墙的人恰好走满，均值 ≈ 3.5/7 ⇒ 转化率被稀释到接近真值的一半、沉默率被抬高。
--   考虑过的另一条路是「分母只算成熟人群」，但那在 7 天窗口下更糟 ——
--   能满足「已满 7×24 小时」的只剩卡在窗口最边缘那一天撞墙的人，样本会小到 0~1 个人。
--   ⇒ 真正的解是把两个窗口拆开。取 30 天后，不成熟者只占最近 7 天，
--     稀释度从约 50% 降到约 12%（7/30），且样本量放大约 4 倍。
--   刻意【不】改分母：分母仍是「撞墙人数」全集，读数时用 mature_users 判断是否已定型。
--   ⚠️ 本窗口【不随看板 range 选择器变】——它是一个固定口径，不是一个视图。
--
-- ⚠️【7×24 小时用时刻算，不折日历日】「撞墙后 7 天内」是一段相对时长，折成日历日会让
--   23:50 撞墙的人只剩 10 分钟的「第一天」。故这一段刻意用 timestamptz + interval 直接比，
--   与本文件其它地方按东八区折日不同 —— 两者服务的问题不同，不是不一致。
--
-- ⚠️ 本函数剔除内部账户与 is_qa，与 0047 的增长指标口径不一致（0047 两者都不剔），
--    二者的人数不可直接相减或对比。
--
-- 返回：wall_users / converted_users / silent_users / mature_users（只给人数，比率由前端算，
--       与 0047 get_activation_stats「只返回人数、不返回百分比」同一条纪律）。
-- =============================================================================

-- invoker（只读 flow_events，不读 auth.users）。flow_events 启用 RLS 且无 select 策略，
-- anon 即使能执行也读不到行；收权同 0063 的理由，是给未来改成 definer 的人上的保险。
create or replace function public.get_quota_wall_stats(
  p_exclude_user_ids uuid[] default '{}'
)
returns table (wall_users int, converted_users int, silent_users int, mature_users int)
language sql
stable
as $$
with today as (
  select (now() + interval '8 hours')::date as d
),
excluded as (
  select coalesce(p_exclude_user_ids, '{}'::uuid[]) as ids
),
-- 撞墙人群 + 每人的首次撞墙时刻（锚点）
walls as (
  select f.user_id, min(f.created_at) as wall_at
  from public.flow_events f, today t, excluded x
  where f.event = 'quota.reached'
    and f.props->>'variant' = 'trial'
    and f.is_qa is not true
    and f.user_id is not null
    and not (f.user_id = any(x.ids))
    -- 撞墙窗口固定近 30 天（闭区间写法沿用 0047，见文件头）。
    -- ⚠️ 这个 30 与下方观察期的 7 是【两个独立口径】，不可为了"看起来一致"而对齐 ——
    --    对齐正是初版那个「平均只走完一半观察期」的坑，理由见上方拍板段。
    and (f.created_at + interval '8 hours')::date >= t.d - 30
  group by f.user_id
),
flags as (
  select
    w.user_id,
    -- 观察期是否已满 7×24 小时（未满者的两个判据都还没定型，见上方 ⚠️）
    (w.wall_at + interval '7 days' <= now()) as is_mature,
    -- 转化：锚点之后 7×24 小时内注册过
    exists (
      select 1 from public.flow_events r
      where r.user_id = w.user_id
        and r.event = 'auth.registered'
        and r.is_qa is not true
        and r.created_at >  w.wall_at
        and r.created_at <= w.wall_at + interval '7 days'
    ) as converted,
    -- 沉默：锚点之后 7×24 小时内没有【任何】flow_events。
    -- 严格 `>` 锚点：quota.reached 自身就是一条 flow_events，含进去则没有人会是沉默的。
    not exists (
      select 1 from public.flow_events a
      where a.user_id = w.user_id
        and a.is_qa is not true
        and a.created_at >  w.wall_at
        and a.created_at <= w.wall_at + interval '7 days'
    ) as silent
  from walls w
)
select
  count(*)::int                                as wall_users,
  count(*) filter (where fl.converted)::int    as converted_users,
  count(*) filter (where fl.silent)::int       as silent_users,
  count(*) filter (where fl.is_mature)::int    as mature_users
from flags fl;
$$;

revoke execute on function public.get_quota_wall_stats(uuid[]) from public, anon, authenticated;
grant  execute on function public.get_quota_wall_stats(uuid[]) to service_role;


-- =============================================================================
-- 守卫：四个函数必须存在、可被 service_role 执行、且【绝不可被 anon/authenticated 执行】。
--
-- 【为什么必须有】0052 那次越权读之所以能在生产上活着，正是因为「只写 grant 不写 revoke」
-- 不会有任何症状：函数照常工作、看板照常显示，唯一的区别是全世界都能读。这类错误没有
-- 任何日常使用会暴露它，只能钉成事务级断言 —— 宁可整份迁移回滚，也不要放一个匿名可读的
-- 经营指标函数上线。
-- 【为什么用 has_function_privilege 而不是直接调一次】SQL Editor 以 postgres 超级用户执行，
-- superuser 绕过一切 ACL 检查，直接调【必然成功】、证明不了任何角色的权限（0052 原话）。
-- =============================================================================
do $$
declare
  fn text;
  fns text[] := array[
    'public.get_core_active_user_days(uuid[])',
    'public.get_growth_funnel(int, uuid[])',
    'public.get_funnel_browse_only(int, uuid[])',
    'public.get_quota_wall_stats(uuid[])'
  ];
begin
  foreach fn in array fns loop
    if to_regprocedure(fn) is null then
      raise exception '守卫失败：% 不存在，整份迁移已回滚。', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception '守卫失败：service_role 无法执行 %，看板会静默降级成「暂不可用」，整份迁移已回滚。', fn;
    end if;
    if has_function_privilege('anon', fn, 'execute')
       or has_function_privilege('authenticated', fn, 'execute') then
      raise exception '守卫失败：anon/authenticated 仍能执行 %（revoke 没生效），这正是 0052 那次生产越权读的形态，整份迁移已回滚。', fn;
    end if;
  end loop;
  raise notice '✅ 守卫通过：0064 四个增长指标 RPC —— service_role 可执行、anon/authenticated 已收权。';
end $$;
