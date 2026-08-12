-- -----------------------------------------------------------------------------
-- Migration : 0062_quota_day_boundary_hk
-- Desc      : 额度日界从 current_date（跟随库/容器时区，生产实为 UTC）改为**东八区**。
--
--   【在修什么】daily_usage_counts / anon_restructure_counts 的 day 列一直按 current_date 落桶，
--   而生产库时区是 UTC —— 于是「每日额度」在**香港时间早上 8 点**才重置，全站文案却写着
--   「明天会自动恢复」。凌晨 0 点半打开产品的用户仍被 429 拦住，且无从理解为什么。
--   审计实测每天有 20%–40% 的调用落在这个错位窗口（08-03 79 次、08-02 43 次）。
--
--   【口径选择：不引入第三套写法】本仓已有两处东八区口径，语义一致：
--     · SQL 侧：0026_get_practice_streak 的 `(now() at time zone 'Asia/Shanghai')::date`
--       （注释原话：「用户的『今天』是北京时间的今天，不是 UTC 的今天」）；
--     · TS 侧：dashboard-shared 的 `HK_OFFSET_MS = 8h` 固定偏移。
--   本迁移一律沿用 0026 的 SQL 写法。东八区自 1991 年起无夏令时，固定偏移与时区名恒等价，
--   不写死 `+08` 是为了与 0026 逐字一致（将来 grep 'Asia/Shanghai' 能一次找齐所有日界）。
--   TS 侧的对侧读取在 src/lib/quota-period.ts（quotaDayKey），两边必须同时上线，理由见下。
--
--   【切换当天的连续性：只多不少，无「少给」路径】设本迁移应用时刻为 T：
--     · T 在香港 08:00–24:00（UTC 同日）→ 新旧桶键完全相同，计数原样延续，不多不少；
--     · T 在香港 00:00–08:00（UTC 还在前一天）→ 新桶键 = 旧桶键 + 1 天，且该桶**必然为空**：
--       旧口径写进 day=D 的行只可能产生于 UTC 的 D 日 = 香港 D 日 08:00 起，整体晚于 T。
--       这批用户当场拿到一份新额度 —— 正是本次要修的那 8 小时，方向是「多给」。
--   故意**不做任何回填 / 合并历史行**：把旧 UTC 桶并进新东八区桶只可能让某些人当天可用次数变少，
--   那是产品方明确不接受的方向。历史行原样保留，它们只被「终身累计」求和读取（求和与分桶无关）。
--
--   【未应用前 / 半上线时的表现】两边（本迁移 与 quota-period.ts）任一先上线都安全：
--     · 只上代码未应用迁移：RPC 仍写 UTC 桶，而 readDailyUsageServer 按东八区键去读 →
--       香港 00:00–08:00 读到空、返回 0（该函数本就是 fail-open 的「便宜早退优化」），
--       权威闸门仍是 bump 的原子递增（读的是旧桶、口径自洽）。行为等同于修复前，最坏白做一次转码。
--     · 只应用迁移未上代码：RPC 写东八区桶，旧代码按 UTC 键读 → 同样只可能读到更小的值 → fail-open。
--   两种半上线状态都只会「多给」，不会误拦任何人。
--
--   幂等：alter … set default 与 create or replace function 可安全重跑；revoke/grant 对已生效者无副作用。
--   ⚠️ 用 npm run db:push 应用（推 main 时 .github/workflows/db-push.yml 会自动执行）。
--      db-push 已按文件包 BEGIN/COMMIT，本文件不自带 begin/commit。
-- Created   : 2026-08-12
-- -----------------------------------------------------------------------------

-- ── 1. 列默认值 ────────────────────────────────────────────────────────────────
-- RPC 都显式传 day，这里改的是「直接 insert 不带 day」那条路（运维脚本 / 将来的新调用点）。
-- 留着 current_date 等于给下一个人留一个只在凌晨 8 小时内发作的坑。
alter table public.daily_usage_counts
  alter column day set default (now() at time zone 'Asia/Shanghai')::date;

alter table public.anon_restructure_counts
  alter column day set default (now() at time zone 'Asia/Shanghai')::date;

-- ── 2. 两个原子递增 RPC ────────────────────────────────────────────────────────
-- 除 current_date → 东八区日期外，逻辑与 0013 / 0015 一字未改（仍是 upsert + returning，无并发偏差）。

-- 原子递增某用户当日某类计数并返回递增后的值（供各付费接口判匿名试用上限与注册熔断上限）。
-- 日界按 Asia/Shanghai：用户的「今天」是北京时间的今天，与 0026 的打卡日界同口径。
create or replace function public.bump_daily_usage(p_user_id uuid, p_kind text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into public.daily_usage_counts (user_id, day, kind, count)
    values (p_user_id, (now() at time zone 'Asia/Shanghai')::date, p_kind, 1)
    on conflict (user_id, day, kind) do update set count = daily_usage_counts.count + 1
    returning count into v_count;
  return v_count;
end;
$$;

-- 原子递增某用户当日整理次数（匿名 restructure 额度），日界同上。
create or replace function public.bump_anon_restructure(p_user_id uuid)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into public.anon_restructure_counts (user_id, day, count)
    values (p_user_id, (now() at time zone 'Asia/Shanghai')::date, 1)
    on conflict (user_id, day) do update set count = anon_restructure_counts.count + 1
    returning count into v_count;
  return v_count;
end;
$$;

-- ── 3. 权限：重申 0054 的收口 ─────────────────────────────────────────────────
-- create or replace 会保留原 ACL，本段是防呆：万一将来有人 drop 后重建（ACL 会重置成
-- Supabase 的默认宽授权），这两行至少在本迁移重跑时能把权限拉回来。
-- 0054 的原话仍成立：这两个函数是 invoker + RLS 生效，今天安全；收权是给将来的误改上保险。
revoke execute on function public.bump_daily_usage(uuid, text) from public, anon, authenticated;
revoke execute on function public.bump_anon_restructure(uuid) from public, anon, authenticated;
grant  execute on function public.bump_daily_usage(uuid, text) to service_role;
grant  execute on function public.bump_anon_restructure(uuid)  to service_role;

-- ── 4. 守卫 ───────────────────────────────────────────────────────────────────
-- 【为什么必须有】这条 bug 的失败形态是**静默**的：日界写错不报错、不影响任何返回值，
-- 只是让一批用户在凌晨被拦住 —— 生产上它已经这样活了几个月没人发现。
-- 故在此把「函数体里必须有东八区、必须没有 current_date」钉成事务级断言，宁可整份迁移回滚。
do $$
declare
  v_src   text;
  v_names text[] := array['bump_daily_usage', 'bump_anon_restructure'];
  v_name  text;
  v_def   text;
  v_tbls  text[] := array['daily_usage_counts', 'anon_restructure_counts'];
  v_tbl   text;
begin
  foreach v_name in array v_names loop
    select p.prosrc into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if v_src is null then
      raise exception '守卫失败：public.% 不存在，额度计数会整体失效，不要放行。', v_name;
    end if;
    if v_src not like '%Asia/Shanghai%' then
      raise exception '守卫失败：public.% 的函数体里没有 Asia/Shanghai，日界没改成东八区，整份迁移已回滚。', v_name;
    end if;
    if v_src like '%current_date%' then
      raise exception '守卫失败：public.% 的函数体里仍有 current_date（跟随容器时区），整份迁移已回滚。', v_name;
    end if;
  end loop;

  -- 权限守卫（签名写全，不做字符串拼装）：service_role 必须能执行，anon 必须不能。
  if not has_function_privilege('service_role', 'public.bump_daily_usage(uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.bump_anon_restructure(uuid)', 'execute') then
    raise exception '守卫失败：service_role 失去了额度计数 RPC 的执行权，计数会静默失效，整份迁移已回滚。';
  end if;
  if has_function_privilege('anon', 'public.bump_daily_usage(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.bump_anon_restructure(uuid)', 'execute') then
    raise exception '守卫失败：anon 仍能执行额度计数 RPC（0054 的收权被冲掉了），整份迁移已回滚。';
  end if;

  foreach v_tbl in array v_tbls loop
    select pg_get_expr(d.adbin, d.adrelid) into v_def
      from pg_attrdef d
      join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      join pg_class c on c.oid = d.adrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = v_tbl and a.attname = 'day';
    if v_def is null or v_def not like '%Asia/Shanghai%' then
      raise exception '守卫失败：public.%.day 的默认值仍不是东八区（当前：%），整份迁移已回滚。', v_tbl, coalesce(v_def, '<无>');
    end if;
  end loop;

  -- 把两个口径的「今天」打进 CI 日志：差 1 说明此刻正处在香港 00:00–08:00 那个错位窗口，
  -- 也就是本次修复的目标时段（迁移应用时间不定，这一行只做取证，不作断言）。
  raise notice '✅ 守卫通过：额度日界已切到东八区。东八区今天=%，UTC 今天=%（差 1 即当前正在错位窗口内）。',
    (now() at time zone 'Asia/Shanghai')::date, (now() at time zone 'UTC')::date;
end $$;
