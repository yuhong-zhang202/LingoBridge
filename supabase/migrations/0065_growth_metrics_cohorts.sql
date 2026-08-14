-- -----------------------------------------------------------------------------
-- Migration : 0065_growth_metrics_cohorts
-- Desc      : 产品增长指标【第二批·群组与使用侧】四个只读 RPC：
--               ① get_weekly_retention_series — W1 留存【曲线】（按群组周分组，逐点给分子/分母）。
--               ② get_stickiness_series       — 粘性比 DAU/MAU 的每日序列。
--               ③ get_user_segments           — 用户分层 × 各层 W1 留存 + 核心活跃人数拆分。
--               ④ get_feature_usage_matrix    — 功能使用矩阵（10 行：人数 / 次数）。
--
--   ⚠️ 依赖 0064 的共用底座 public.get_core_active_user_days(uuid[])：本文件【必须在 0064 之后】
--      应用（language sql 函数在 create 时就会解析函数体，底座不存在则本文件直接报错）。
--
--   ⚠️⚠️【口径与 0047 那批增长指标【刻意不一致】，不可互相对照】
--      本文件所有函数【剔除内部账户与 is_qa 自测流量】，而 0047 的
--      get_core_active_stats / get_activation_stats / get_weekly_retention_stats【两者都不剔】。
--      两批的人数【不可直接相减、不可当同一口径对比】。每个函数下方逐一重申。
--
--   🔴【为什么新建 get_weekly_retention_series 而不是改 0047 的 get_weekly_retention_stats】
--      原地改会让现有看板的 W1 卡当场断掉：src/lib/db/dashboard-metrics.ts 的 fetchWeeklyRetention
--      期望的是【单行 {w1_n, w1_ret, w1_rate}】，改成按周分组的多行后，它会取到第一周那一行
--      并把它当成全量 W1 —— 不报错、不降级、数字静默变小。0043~0048 的既有函数一个字不动。
--
--   ⚠️ 窗口 / 日界 / 内部账户名册 / 权限三条纪律与 0064 完全相同，不再重复长篇论述，见 0064 顶注：
--      · 窗口 = 闭区间 [今日-p_window_days, 今日]（沿用 0047，比应用层多一天，不可与主看板相减）；
--      · 日界 = (ts + interval '8 hours')::date（沿用 0047，依赖库 TimeZone=UTC）；
--      · 内部账户名册由调用方传参（TS 侧 INTERNAL_ACCOUNT_IDS 是唯一真源，范式同 0063）；
--      · 每个函数【自带 revoke】（0052 那次生产越权读的直接教训）。
--
--   幂等：create or replace function + revoke/grant，可安全重跑。
--   ⚠️ 用 npm run db:push 应用；db-push 已按文件包 BEGIN/COMMIT，本文件不自带 begin/commit。
-- Created   : 2026-08-14
-- -----------------------------------------------------------------------------


-- =============================================================================
-- 函数 ①：get_weekly_retention_series(p_window_days int, p_exclude_user_ids uuid[])
-- W1 留存【曲线】：每个群组周一个点，逐点返回 (周起始日, 分母, 分子)。
--
-- 【群组定义保持 0047 现状不变（刻意不改）】每个注册用户的群组 = 其【首次核心活跃日】所在的周，
--   【不是注册日】。理由沿用 0047：注册日群组会把「注册了但从没用过」的人算进分母，
--   那批人的留存恒为 0、只会把曲线整体压平，答不了「用过的人会不会回来」这个问题。
--   首活日按【全历史】取 min，不受 p_window_days 影响（窗口只决定展示哪几周）。
--
-- 【W1 定义维持 0047 的区间留存】= 首活日 D0 之后的 D+1~D+7 内【任意一天】再次核心活跃。
--   不是「恰好第 7 天」（0043 的 d7 是精确等日，本函数不沿用，两者不可对照）。
--
-- 【只计成熟用户：首活日 ≤ 今日-7】未满 7 天的人还没走完观察期，计进分母会把最新那一周的
--   留存率系统性拉低 —— 而最新那一周恰恰是最多人盯着看的一格。故未成熟用户【整个不进分母】，
--   表现为最新的周可能人数很少甚至缺失（诚实），而不是一个假的低留存率。
--
-- 【周起始日 = date_trunc('week')，即周一】PostgreSQL 的 ISO 周口径。曲线的 x 轴标签用它。
--
-- 【回看范围 greatest(p_window_days, 30) 天】逐字沿用 0047 的理由：7 天视图下
--   「首活日 ≥ 今日-7」与成熟条件「首活日 ≤ 今日-7」一夹，分母会坍缩成单独一天的群组、
--   样本极窄且随机。固定至少回看 30 天避免复现。
--
-- 【只给分子分母、不给百分比】与 0047 get_activation_stats 同一条纪律：个位数样本下百分比是
--   假精度，前端必须能显示 n（产品方硬性要求）。比率由 TS 侧算（除零统一处理、可单测）。
--
-- ⚠️ 本函数剔除内部账户与 is_qa，与 0047 的增长指标口径不一致（0047 两者都不剔），
--    二者的人数不可直接相减或对比。
-- =============================================================================

-- invoker：本函数不直接读 auth.users —— 真注册集在底座 get_core_active_user_days(0064，
-- security definer) 里已经定好了。少一个 definer 就少一个提权面（0063 同款立场）。
create or replace function public.get_weekly_retention_series(
  p_window_days int,
  p_exclude_user_ids uuid[] default '{}'
)
returns table (week_start date, cohort_n int, returned_n int)
language sql
stable
as $$
with today as (
  select (now() + interval '8 hours')::date as d
),
-- 底座：注册用户的 (user_id, 核心活跃日)，已剔内部账户与 is_qa（口径见 0064）
core as (
  select c.user_id as uid, c.active_day as cday
  from public.get_core_active_user_days(p_exclude_user_ids) c
),
-- 群组：每人的首次核心活跃日（全历史 min，不受窗口影响）
cohorts as (
  select co.uid, min(co.cday) as first_day
  from core co
  group by co.uid
),
-- 是否在 D+1~D+7 内任意一天再次核心活跃（区间留存）
flags as (
  select
    ch.uid,
    ch.first_day,
    exists (
      select 1 from core a
      where a.uid = ch.uid
        and a.cday between ch.first_day + 1 and ch.first_day + 7
    ) as returned_w1
  from cohorts ch
),
-- 成熟且落在回看范围内的群组
mature as (
  select f.uid, f.first_day, f.returned_w1
  from flags f, today t
  where f.first_day >= t.d - greatest(p_window_days, 30)
    and f.first_day <= t.d - 7
)
select
  date_trunc('week', m.first_day::timestamp)::date as week_start,
  count(*)::int                                    as cohort_n,
  count(*) filter (where m.returned_w1)::int       as returned_n
from mature m
group by date_trunc('week', m.first_day::timestamp)::date
order by 1;
$$;

revoke execute on function public.get_weekly_retention_series(int, uuid[]) from public, anon, authenticated;
grant  execute on function public.get_weekly_retention_series(int, uuid[]) to service_role;


-- =============================================================================
-- 函数 ②：get_stickiness_series(p_window_days int, p_exclude_user_ids uuid[])
-- 粘性比 DAU/MAU 的每日序列：窗口内每一天返回 (日期, DAU, MAU)。
--
-- 【DAU】当日核心活跃的注册用户去重数。口径【复用 get_core_active_stats(0047) 的定义】，
--   但【不复用它的函数】——那个函数不剔内部账户也不剔 is_qa，与本批口径不一致，
--   混用会得到一条自己跟自己打架的曲线。定义只有一份（0064 的底座），实现走底座。
-- 【MAU】以该日为右端点、回看 30 天（[day-29, day]）的核心活跃注册用户去重数，即滚动 MAU。
--   ⚠️ 窗口最左边那几天的 MAU 会回看到【窗口起点之前】—— 这是对的，滚动 MAU 本就该如此；
--      但也意味着这些点用到了窗口外的数据，别拿「窗口内总人数」去核对它。
-- 【比率不在 SQL 里算】DAU/MAU 的除法与四舍五入统一放 TS（MAU=0 时返回 null 而不是 0，
--   诚实占位；同 0047 w1_rate 的做法）。
--
-- 【为什么一定要给序列而不是一个数】DAU/MAU 是个比率，单点数值几乎没有解释力（内测期
--   一个人的进出就能让它跳 10 个点）。要看的是它随时间的形状，故逐日返回。
--
-- 【逐日左连接 generate_series】没有任何人活跃的那天也必须占一行、值为 0 —— 缺行会让前端的
--   日期轴自己去补，而那正是最容易把「那天没人」和「那天没数据」搞混的地方。
--
-- ⚠️ 本函数剔除内部账户与 is_qa，与 0047 的增长指标口径不一致（0047 两者都不剔），
--    二者的人数不可直接相减或对比。
-- =============================================================================

-- invoker（理由同 ①：真注册集在底座里定，本函数不碰 auth）。
create or replace function public.get_stickiness_series(
  p_window_days int,
  p_exclude_user_ids uuid[] default '{}'
)
returns table (day date, dau int, mau int)
language sql
stable
as $$
with today as (
  select (now() + interval '8 hours')::date as d
),
bounds as (
  select t.d - p_window_days as from_day, t.d as to_day from today t
),
core as (
  select c.user_id as uid, c.active_day as cday
  from public.get_core_active_user_days(p_exclude_user_ids) c
),
axis as (
  select gs.ts::date as ax_day
  from bounds b, generate_series(b.from_day::timestamp, b.to_day::timestamp, interval '1 day') as gs(ts)
)
select
  x.ax_day,
  (select count(distinct c.uid) from core c where c.cday = x.ax_day)::int                        as dau,
  -- 滚动 30 天（含当日）：[day-29, day]
  (select count(distinct c.uid) from core c where c.cday between x.ax_day - 29 and x.ax_day)::int as mau
from axis x
order by x.ax_day;
$$;

revoke execute on function public.get_stickiness_series(int, uuid[]) from public, anon, authenticated;
grant  execute on function public.get_stickiness_series(int, uuid[]) to service_role;


-- =============================================================================
-- 函数 ③：get_user_segments(p_window_days int, p_exclude_user_ids uuid[])
-- 用户分层 × 各层 W1 留存 + 核心活跃人数拆分。返回一张长表，用 kind 区分三类行：
--
--   kind='total'      分母行，供前端算占比（绝不在 SQL 里算百分比，同 ① 的理由）
--     · segment_base  分层人群总数 = 窗口内【核心活跃 ∪ 有 corpus 新增】的注册用户
--     · core_active   窗口内核心活跃注册用户数（= 下面 core_split 三行之和）
--
--   kind='segment'    四层（前三层互斥、第四层与它们【正交】，产品方明确要求单独一行）
--     · qbank_only    仅题库：窗口内有 review_events，且 corpus 无新增
--     · ai_only       仅 AI 主线：窗口内 corpus 有新增，且无 review_events
--     · both          两者都用
--     · high_freq     高频用户：窗口内核心活跃天数 ≥ 3
--                     ⚠️ 与上三层【正交】——它会与前三层重叠，四行相加【没有意义】，别求和。
--
--   kind='core_split' 核心活跃人数的拆分（用于解释「核心活跃 18 人里混了谁」）。三行互斥、
--                     其和 = total.core_active：
--     · mainline      只有 AI 主线信号（api_usage_logs）
--     · review_only   只有闪卡/收藏信号（review_events / saved_* / *.last_reviewed_at）
--     · both_signals  两侧都有
--
-- 【为什么分层的分母不是「窗口内全部注册用户」】那会把「注册了但这个窗口没来」的人算进分母，
--   四层占比之和永远远小于 1、且随窗口长度漂移，看不出任何东西。分母取【这个窗口来过的人】。
--   取「核心活跃 ∪ corpus 新增」而不是单取核心活跃：corpus 新增理论上可能不伴随任何
--   api_usage_logs 行（例如纯文字路径下游全部失败），那种用户在 ai_only 层里却不在核心活跃里，
--   分母漏掉他就会出现占比 > 100%。并集堵住这个洞。
--
-- 【W1 留存与函数 ① 同一定义】首活日 D0（全历史 min）+ D+1~D+7 任一天再活跃，只计成熟用户
--   （首活日 ≤ 今日-7）。故每层的 w1_n【小于】该层人数 —— 那不是算错，是把还没走完观察期的人
--   排除在分母外（见 ① 的论述）。w1_n / w1_ret 都给出来，前端必须显示 n。
--
-- ⚠️ review_events / corpus 两张表【没有 is_qa 列】，只剔得掉内部账户（见 0064 顶注）。
-- ⚠️ 本函数剔除内部账户与 is_qa，与 0047 的增长指标口径不一致（0047 两者都不剔），
--    二者的人数不可直接相减或对比。
-- =============================================================================

-- invoker（理由同 ①）。
create or replace function public.get_user_segments(
  p_window_days int,
  p_exclude_user_ids uuid[] default '{}'
)
returns table (kind text, segment text, users int, w1_n int, w1_ret int)
language sql
stable
as $$
with today as (
  select (now() + interval '8 hours')::date as d
),
bounds as (
  select t.d - p_window_days as from_day, t.d as to_day from today t
),
excluded as (
  select coalesce(p_exclude_user_ids, '{}'::uuid[]) as ids
),
core as (
  select c.user_id as uid, c.active_day as cday, c.has_ai, c.has_other
  from public.get_core_active_user_days(p_exclude_user_ids) c
),
-- 窗口内每人的核心活跃概况：活跃天数 + 两侧信号是否出现过
core_win as (
  select c.uid,
         count(distinct c.cday)::int as active_days,
         bool_or(c.has_ai)    as any_ai,
         bool_or(c.has_other) as any_other
  from core c, bounds b
  where c.cday between b.from_day and b.to_day
  group by c.uid
),
-- 窗口内有 corpus 新增的用户（服务端事实；本表无 is_qa 列，只剔内部账户）
corpus_win as (
  select distinct cp.user_id as uid
  from public.corpus cp, bounds b, excluded x
  where (cp.created_at + interval '8 hours')::date between b.from_day and b.to_day
    and not (cp.user_id = any(x.ids))
),
-- 窗口内有闪卡复习的用户（0046 权威流水；本表无 is_qa 列，只剔内部账户）
review_win as (
  select distinct re.user_id as uid
  from public.review_events re, bounds b, excluded x
  where (re.created_at + interval '8 hours')::date between b.from_day and b.to_day
    and not (re.user_id = any(x.ids))
),
-- 分层人群 = 核心活跃 ∪ corpus 新增，且必须是【注册用户】。
-- core_win 的成员天然已是注册用户（底座已 join auth.users）；corpus_win 里可能混进匿名用户，
-- 故与底座的全量注册活跃集合取交集来过滤 —— 用 core 的 uid 全集当注册名册的代理，
-- 是为了不在本函数里再读一次 auth.users（那要求 security definer，见函数头的立场）。
-- ⚠️ 代价必须写明：一个【全历史从未有过任何核心活跃信号】的注册用户，即使窗口内建了 corpus，
--    也进不了分母与分层。方向是保守的（少算，绝不虚高）。
--    【这条代价有多大 —— 依据而非推测】截至 2026-08-14 的代码，`/api/corpus`（唯一的 corpus
--    入库端点）全仓库只有一个调用方：src/app/restructure/page.tsx —— 即用户必然先走过
--    /api/restructure（那是一次会写 api_usage_logs 的 AI 调用）才可能建成 corpus。
--    且此处的判据用的是【全历史】核心活跃（不是窗口内），所以要落进这个洞，用户得做到
--    「历史上一次 AI 调用/复习/收藏都没有过，却建成了一条 corpus」。
--    已知的两种可能路径：① 那次 restructure 记账没写上 user_id；② 那次 AI 调用被标了 is_qa
--    （本函数剔它、corpus 表没有 is_qa 列剔不掉）—— 后者恰恰是自测流量，被排除是想要的结果。
--    ⚠️ 若将来给 corpus 增加不经 restructure 的入库路径，这条依据即失效，须回来重估。
registered_seen as (
  select distinct core.uid from core
),
base as (
  select cw.uid from core_win cw
  union
  select cpw.uid from corpus_win cpw
  where cpw.uid in (select rs.uid from registered_seen rs)
),
-- 每人的分层判据
marks as (
  select
    b.uid,
    (b.uid in (select r.uid from review_win r)) as has_review,
    (b.uid in (select c2.uid from corpus_win c2)) as has_corpus,
    coalesce((select cw.active_days from core_win cw where cw.uid = b.uid), 0) as active_days,
    coalesce((select cw.any_ai    from core_win cw where cw.uid = b.uid), false) as any_ai,
    coalesce((select cw.any_other from core_win cw where cw.uid = b.uid), false) as any_other,
    (b.uid in (select cw.uid from core_win cw)) as is_core
  from base b
),
-- W1 留存（定义与 get_weekly_retention_series 逐字相同）
cohorts as (
  select core.uid, min(core.cday) as first_day
  from core
  group by core.uid
),
w1 as (
  select
    ch.uid,
    (ch.first_day <= (select t.d - 7 from today t)) as is_mature,
    exists (
      select 1 from core a
      where a.uid = ch.uid
        and a.cday between ch.first_day + 1 and ch.first_day + 7
    ) as returned_w1
  from cohorts ch
),
seg as (
  select
    m.uid,
    case
      when m.has_review and not m.has_corpus then 'qbank_only'
      when m.has_corpus and not m.has_review then 'ai_only'
      when m.has_corpus and m.has_review     then 'both'
      else null
    end as seg_key,
    (m.active_days >= 3) as is_high_freq,
    m.is_core,
    m.any_ai,
    m.any_other
  from marks m
),
joined as (
  select s.*, coalesce(w.is_mature, false) as is_mature, coalesce(w.returned_w1, false) as returned_w1
  from seg s
  left join w1 w on w.uid = s.uid
)
-- 三层互斥分层
select 'segment'::text, j.seg_key, count(*)::int,
       count(*) filter (where j.is_mature)::int,
       count(*) filter (where j.is_mature and j.returned_w1)::int
from joined j
where j.seg_key is not null
group by j.seg_key
union all
-- 高频层（与上三层正交，单独一行；恒返回一行，0 人也要有）
select 'segment', 'high_freq', count(*) filter (where j.is_high_freq)::int,
       count(*) filter (where j.is_high_freq and j.is_mature)::int,
       count(*) filter (where j.is_high_freq and j.is_mature and j.returned_w1)::int
from joined j
union all
-- 分母行
select 'total', 'segment_base', count(*)::int, null::int, null::int from joined j
union all
select 'total', 'core_active', count(*) filter (where j.is_core)::int, null::int, null::int from joined j
union all
-- 核心活跃人数拆分（三行互斥，和 = total.core_active）
select 'core_split', 'mainline',
       count(*) filter (where j.is_core and j.any_ai and not j.any_other)::int, null::int, null::int
from joined j
union all
select 'core_split', 'review_only',
       count(*) filter (where j.is_core and j.any_other and not j.any_ai)::int, null::int, null::int
from joined j
union all
select 'core_split', 'both_signals',
       count(*) filter (where j.is_core and j.any_ai and j.any_other)::int, null::int, null::int
from joined j;
$$;

revoke execute on function public.get_user_segments(int, uuid[]) from public, anon, authenticated;
grant  execute on function public.get_user_segments(int, uuid[]) to service_role;


-- =============================================================================
-- 函数 ④：get_feature_usage_matrix(p_window_days int, p_exclude_user_ids uuid[])
-- 功能使用矩阵，10 行 × (使用人数去重, 使用次数)。人均次数由 TS 侧算（除零统一处理）。
--
-- 【三组十项及其数据源】
--   主线  story        讲故事      corpus 新增行
--   主线  match        匹配题目    flow_events match.view_rendered
--   主线  analysis     题目分析    flow_events flow.ai_call 且 props.stage='analysis'
--   主线  practice     对话练习    practice_sessions 新增行
--   沉淀  lib_stories  我的经历    flow_events page.tab_view 且 props.tab='library_stories'
--   沉淀  lib_cards    收藏的表达  同上，tab='library_cards'
--   沉淀  lib_words    生词        同上，tab='library_words'
--   沉淀  lib_pron     发音        同上，tab='library_pron'
--   复习  review       闪卡复习    review_events 行
--   复习  qbank        题库浏览    flow_events page.tab_view 且 props.tab 以 'qbank_' 开头
--
-- 🔴🔴【沉淀四项与题库浏览依赖 page.tab_view，该埋点在本次上线前【零历史数据】】
--   它是 2026-08-14 才加的（commit 09a6f7d）。上线之前这五格【必然全 0】，那不是「没人用」。
--   ⇒ TS 侧带一个起算日标记（TAB_VIEW_BASELINE_START）随响应下发，前端必须显示
--     「自 YYYY-MM-DD 起统计」。没有那行小字，这张表第一天就会被读成「素材库没人用」。
--
-- ⚠️⚠️【page.tab_view 的两条已知偏差 —— 用这五格做任何比较之前必须先读（全文见
--        src/lib/event-schema.ts 的 TAB_ID 条目）】
--   ① 默认 tab 在页面挂载时也上报 ⇒ 桌面端素材库默认 cards、题库两端默认「维度设计」，
--      故 **library_cards 与 qbank_dimension 天然偏高**，含大量「只打开页面、没主动切过」的人。
--   ② 移动端素材库默认落在 hub（分类首页，不上报）⇒ 移动端没有 ① 那个偏高，**双端口径不对称**。
--   ⇒ 【lib_cards 与 qbank 这两格不可与其它 tab 直接比大小】。另：tab_view 的去重是模块级、
--      跨页面存活，计的是「tab 切换/进入次数」而非页面访问次数，别拿它与 page.view 相除。
--
-- 【0 行也必须占一行】靠 features 目录左连接保证。某功能计 0 恰恰是最需要被看见的信号
--   （埋点坏了 / 功能入口挂了 / 真没人用，三者在数据里长得一样，先得有这一行才谈得上分辨）。
--
-- ⚠️ corpus / practice_sessions / review_events 三张表【没有 is_qa 列】，只剔得掉内部账户
--    ⇒ 主线的 story/practice 与复习的 review 三格相对 flow_events 那几格系统性偏高。
-- ⚠️ 本函数剔除内部账户与 is_qa，与 0047 的增长指标口径不一致（0047 两者都不剔），
--    二者的人数不可直接相减或对比。
-- =============================================================================

-- invoker：只读业务表，不碰 auth.users。
-- ⚠️【本函数刻意不限定注册用户】使用矩阵要回答「这个功能有多少人在用」，匿名试用的人也是人；
--    与上面三个函数（分母是注册用户）口径不同，两边的人数不可互相对照。
create or replace function public.get_feature_usage_matrix(
  p_window_days int,
  p_exclude_user_ids uuid[] default '{}'
)
returns table (feature_key text, users int, uses int)
language sql
stable
as $$
with today as (
  select (now() + interval '8 hours')::date as d
),
bounds as (
  select t.d - p_window_days as from_day, t.d as to_day from today t
),
excluded as (
  select coalesce(p_exclude_user_ids, '{}'::uuid[]) as ids
),
-- 功能目录：保证 0 行的功能也占一行
features(feature_key) as (
  values ('story'::text), ('match'), ('analysis'), ('practice'),
         ('lib_stories'), ('lib_cards'), ('lib_words'), ('lib_pron'),
         ('review'), ('qbank')
),
events as (
  -- 主线 · 讲故事
  select 'story'::text as fk, cp.user_id as uid
    from public.corpus cp, bounds b, excluded x
   where (cp.created_at + interval '8 hours')::date between b.from_day and b.to_day
     and not (cp.user_id = any(x.ids))
  union all
  -- 主线 · 对话练习
  select 'practice', ps.user_id
    from public.practice_sessions ps, bounds b, excluded x
   where (ps.created_at + interval '8 hours')::date between b.from_day and b.to_day
     and not (ps.user_id = any(x.ids))
  union all
  -- 复习 · 闪卡复习
  select 'review', re.user_id
    from public.review_events re, bounds b, excluded x
   where (re.created_at + interval '8 hours')::date between b.from_day and b.to_day
     and not (re.user_id = any(x.ids))
  union all
  -- flow_events 侧六项：一次扫描按事件/props 分派（user_id 允许为空 —— 计次数、不计人数）
  select
    case
      when f.event = 'match.view_rendered' then 'match'
      when f.event = 'flow.ai_call'        then 'analysis'
      when f.props->>'tab' = 'library_stories' then 'lib_stories'
      when f.props->>'tab' = 'library_cards'   then 'lib_cards'
      when f.props->>'tab' = 'library_words'   then 'lib_words'
      when f.props->>'tab' = 'library_pron'    then 'lib_pron'
      else 'qbank'
    end,
    f.user_id
  from public.flow_events f, bounds b, excluded x
  where f.is_qa is not true
    and (f.user_id is null or not (f.user_id = any(x.ids)))
    and (f.created_at + interval '8 hours')::date between b.from_day and b.to_day
    and (
      f.event = 'match.view_rendered'
      or (f.event = 'flow.ai_call' and f.props->>'stage' = 'analysis')
      or (f.event = 'page.tab_view' and f.props->>'tab' in
            ('library_stories', 'library_cards', 'library_words', 'library_pron'))
      or (f.event = 'page.tab_view' and f.props->>'tab' like 'qbank\_%')
    )
)
select ft.feature_key, count(distinct e.uid)::int as users, count(e.fk)::int as uses
from features ft
left join events e on e.fk = ft.feature_key
group by ft.feature_key
order by ft.feature_key;
$$;

revoke execute on function public.get_feature_usage_matrix(int, uuid[]) from public, anon, authenticated;
grant  execute on function public.get_feature_usage_matrix(int, uuid[]) to service_role;


-- =============================================================================
-- 守卫：四个函数必须存在、service_role 可执行、anon/authenticated 绝不可执行。
-- 理由与 0064 的守卫完全相同（0052 越权读没有任何症状，只能靠断言钉住），不重复论述。
-- 另加一条：底座 get_core_active_user_days 必须在场 —— 本文件三个函数全靠它定口径，
-- 它若缺席，三个函数会在 create 时就报错；这里再断言一次是给「有人单独重跑本文件」的场景兜底。
-- =============================================================================
do $$
declare
  fn text;
  fns text[] := array[
    'public.get_weekly_retention_series(int, uuid[])',
    'public.get_stickiness_series(int, uuid[])',
    'public.get_user_segments(int, uuid[])',
    'public.get_feature_usage_matrix(int, uuid[])'
  ];
begin
  if to_regprocedure('public.get_core_active_user_days(uuid[])') is null then
    raise exception '守卫失败：共用底座 public.get_core_active_user_days 不存在（0064 没跑），整份迁移已回滚。';
  end if;
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
  raise notice '✅ 守卫通过：0065 四个增长指标 RPC —— service_role 可执行、anon/authenticated 已收权。';
end $$;
