-- -----------------------------------------------------------------------------
-- Migration : 0063_global_ai_cost_today
-- Desc      : 新增只读聚合 RPC `global_ai_cost_today_cny(uuid[])` —— 返回「今日（东八区）全站 AI 花费」，
--             供全局预算熔断（src/lib/global-budget-breaker.ts）判定是否停掉匿名会话的新 AI 调用。
--
--   【为什么必须下推到 DB 端算】看板那边是把行拉回 Node 再 reduce 求和的（fetchAllRows 分页 + 应用层累加），
--   那条路在这里【不可用】，原因不是慢，是**会算错**：分页有页数上限，触顶即静默少报（看板已用
--   dataTruncated 把这件事标出来）。少报对看板只是数字偏低，对熔断则是**该断的时候不断** ——
--   而「行数暴涨」恰恰就是熔断唯一要对付的那个场景，两者同时发生。故必须让 PG 端一次 sum 出精确值。
--   顺带的好处：单次往返、只回一个标量，可以被每个 AI 请求高频调用（实际还有进程内 TTL 缓存兜着）。
--
--   【口径与看板逐条对齐，不新造第四套】
--     · 日界   —— `(now() at time zone 'Asia/Shanghai')` 取东八区当日 00:00，与 0026 打卡、0062 额度日界同写法；
--     · 自测   —— `is_qa is not true`（0059），刻意不用 `= false`：NULL 行要保留，宁可少剔绝不错剔；
--     · 内部号 —— 名册（INTERNAL_ACCOUNT_IDS）是 TS 侧的唯一真源，故【由调用方传参】而不在 SQL 里再抄一份；
--                 `user_id is null` 的行保留（补归属列前的老行 / 无归属调用属正常口径）。
--   三条与 dashboard-shared 的 EXCLUDE_QA_TRAFFIC / EXCLUDE_INTERNAL_BY_USER 完全同义。
--
--   ⚠️【is_qa 用在这里的边界】0059 的红线是「is_qa 永久禁止用于额度/权限/计费/RLS 判定」，并已注明
--   「计费」指对用户收费/扣额度。本 RPC 不判定任何**单个用户**的额度或权限，它只回答「全站今天烧了多少钱」，
--   与看板剔除自测流量是同一件事。但要如实说清代价：熔断的判定输入里因此含有一个由
--   QA_TRAFFIC_TOKEN（服务端密钥）把守的排除项 —— 若该 token 泄漏，持有者可以让自己的花费不计入本和，
--   使熔断【更晚触发】（方向是放行，绝不会误伤真实用户）。不加这条排除的代价则是确定发生的：
--   产品方自测几轮就把全站匿名入口熔断掉。两害相权取其轻，并把 token 泄漏时须轮换记在这里。
--
--   【为什么不建新索引】过滤主力是 created_at 范围，0012 的 api_usage_logs_created_idx (created_at desc)
--   已经覆盖；is_qa 是布尔、选择性极差（0059 已论证过不给它建索引）。真到需要时按当时的执行计划再建。
--
--   【未应用时的表现】代码先上线、迁移未应用 → RPC 不存在 → 调用报错 → 读侧按「读不到」处理（失败开放，
--   理由见 src/lib/global-budget-breaker.ts 顶注），表现为**熔断静默不生效、其余一切正常**，
--   与改动前的世界完全一样（每日/终身额度闸不受影响）。窗口 = CI 应用迁移与 Zeabur 构建的时差，
--   观察服务端日志里的 [budget-breaker] 告警即可确认已恢复。
--
--   幂等：create or replace function + revoke/grant，可安全重跑。
--   ⚠️ 用 npm run db:push 应用（推 main 时 .github/workflows/db-push.yml 会自动执行）。
--      db-push 已按文件包 BEGIN/COMMIT，本文件不自带 begin/commit。
-- Created   : 2026-08-12
-- -----------------------------------------------------------------------------

-- 今日（东八区）全站 AI 花费合计，单位人民币元。
-- @param p_exclude_user_ids  内部账户 user_id 数组（TS 侧 INTERNAL_ACCOUNT_IDS 传入）；空数组 = 不排除任何人。
-- 无任何写副作用；stable 而非 immutable（读表 + now()）。
create or replace function public.global_ai_cost_today_cny(p_exclude_user_ids uuid[] default '{}')
returns numeric
language sql
stable
as $$
  select coalesce(sum(l.estimated_cost_cny), 0)
    from public.api_usage_logs l
   where l.created_at >= (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')
     -- 0059 口径：NULL（迁移生效前的历史行）不算自测，原样计入
     and l.is_qa is not true
     -- 内部账户排除；user_id 为 null 的行保留（与 EXCLUDE_INTERNAL_BY_USER 的 or(is.null, not.in) 同义）
     and (l.user_id is null or not (l.user_id = any(coalesce(p_exclude_user_ids, '{}'::uuid[]))));
$$;

-- ── 权限：与 0054 / 0062 同一条纪律 ──
-- 本函数只由服务端（service_role）调用。它读的是全平台成本，属机密：0012 起 api_usage_logs
-- 即 service_role-only（启用 RLS 且无 select 策略）。本函数是 invoker（未标 security definer），
-- 故 anon 即使能执行也读不到行；收权是给将来「有人图省事改成 security definer」上的保险 ——
-- 那一刻若没有这两行，全平台每日成本就成了一个匿名可查的数字。
revoke execute on function public.global_ai_cost_today_cny(uuid[]) from public, anon, authenticated;
grant  execute on function public.global_ai_cost_today_cny(uuid[]) to service_role;

-- ── 守卫 ──
-- 【为什么必须有】熔断的失败形态是**静默**的：函数体里日界写错、或漏了某个排除项，
-- 不报错、不影响任何返回值，只是让熔断早断（误伤真实用户）或晚断（钱照烧）。
-- 且它平时恒不触发，没有任何日常使用会暴露这些错误。故把口径钉成事务级断言，宁可整份迁移回滚。
do $$
declare
  v_src   text;
  v_today numeric;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'global_ai_cost_today_cny';
  if v_src is null then
    raise exception '守卫失败：public.global_ai_cost_today_cny 不存在，熔断会静默失效，不要放行。';
  end if;
  if v_src not like '%Asia/Shanghai%' then
    raise exception '守卫失败：函数体里没有 Asia/Shanghai，日界不是东八区，整份迁移已回滚。';
  end if;
  if v_src not like '%is_qa is not true%' then
    raise exception '守卫失败：函数体里没有 is_qa is not true，自测流量会把产品方自己熔断，整份迁移已回滚。';
  end if;
  if v_src not like '%p_exclude_user_ids%' then
    raise exception '守卫失败：函数体没有消费 p_exclude_user_ids，内部账户排除失效，整份迁移已回滚。';
  end if;

  -- 权限守卫（签名写全，不做字符串拼装）：service_role 必须能执行，anon 必须不能。
  if not has_function_privilege('service_role', 'public.global_ai_cost_today_cny(uuid[])', 'execute') then
    raise exception '守卫失败：service_role 无法执行本函数，熔断读不到数会一路失败开放，整份迁移已回滚。';
  end if;
  if has_function_privilege('anon', 'public.global_ai_cost_today_cny(uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.global_ai_cost_today_cny(uuid[])', 'execute') then
    raise exception '守卫失败：anon/authenticated 仍能执行本函数（收权被冲掉了），整份迁移已回滚。';
  end if;

  -- 冒烟：真调一次，确认能跑通且非负（空表返回 0，不是 null —— coalesce 兜住了）。
  select public.global_ai_cost_today_cny('{}'::uuid[]) into v_today;
  if v_today is null or v_today < 0 then
    raise exception '守卫失败：函数返回 %（应为 ≥0 的数），整份迁移已回滚。', coalesce(v_today::text, '<null>');
  end if;
  raise notice '✅ 守卫通过：全局预算熔断的取数函数已就绪。此刻东八区今日已花费 = ¥%（东八区今天=%）。',
    round(v_today, 4), (now() at time zone 'Asia/Shanghai')::date;
end $$;
