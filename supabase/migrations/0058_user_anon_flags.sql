-- -----------------------------------------------------------------------------
-- Migration : 0058_user_anon_flags
-- Desc      : 「按用户成本 Top-N」与「匿名/登录成本占比」的身份口径权威源 ——
--             返回每个【有过 API 调用的】用户的【当前】身份布尔，供成本看板判断
--             「这个 user_id 现在到底是不是匿名」。补齐 0043/0044/0045/0047 那批
--             「口径权威源一律取 auth.users」的最后一处欠账（成本看板此前仍在用旧标记）。
--
--             【为什么必须新加这个 RPC（线上真实误导，2026-08-07 确证）】
--             本项目「注册 = updateUser({email,password}) 升级当前匿名账号，user_id 不变」
--             （见 src/lib/auth.ts 顶注）。而 api_usage_logs.is_anonymous 记的是【调用发生
--             那一刻】的身份，于是任何「先匿名试用、后注册」的转化用户都会永久留着一批
--             is_anonymous=true 的历史行；看板的旧口径是「同一 user_id 只要有一条匿名即标匿名」，
--             结果转化最成功的那类用户在成本榜上顶着「匿名」标签排第一，看起来像在薅羊毛。
--             实测个案：某用户匿名期仅 2 次调用（¥0.175）即注册，之后作为注册用户用了 107 次
--             （¥5.09），却被整体标成匿名。
--             雪上加霜：绑邮箱后 updateUser 不换发新 token（stale JWT），注册后的一小段时间里
--             调用仍会被记成匿名 —— 该标记本就不可靠，不能拿来判身份。
--
--             【返回什么·不返回什么（隐私红线，勿改）】
--             只返回 (id uuid, is_anonymous boolean) 两列。成本看板刻意【不 join 任何个人信息】
--             （见 api/dashboard/route.ts「隐私」段注释）：绝不返回邮箱 / 姓名 / 注册时间 /
--             任何 PII，本函数将来也不得往这个返回集里加列。
--
--             【口径（与 0043/0044/0045/0047 的真注册集逐字一致，勿各写各的）】
--               · 真注册用户 = auth.users where is_anonymous is not true and email 非空；
--               · 本函数的 is_anonymous = 「不在真注册集里」= (u.is_anonymous is true)
--                 or email 为空 —— 即「当前不是真注册用户」一律算匿名，与看板别处
--                 「注册 / 匿名」的划分完全同源，两块数字不会互相打架。
--               · 只返回【在 api_usage_logs 里出现过】的用户：成本看板只需要判这些 id，
--                 其余账号返回了也用不上，白白撑大结果集（见下方 1000 行护栏）。
--                 走 api_usage_logs_user_idx（0021 的部分索引）半连接，成本可忽略。
--
--             【1000 行护栏 · 与调用方的约定】
--             PostgREST 对不带 range 的请求静默截断到 db-max-rows（本项目按 1000 处理，
--             见 dashboard-shared.ts 的分页说明）。调用方 fetchUserAnonFlags 收到 ≥1000 行
--             时【判定为可能被截断 → 整块降级 + 打错误日志】，绝不拿半张身份表去标人。
--             届时该把本函数改成带参数（按 user_id 数组查）或让调用方分页，不要默默调大。
--
--             【未跑本迁移前，看板会降级成什么样（不 500、但数字仍是旧口径）】
--               · fetchUserAnonFlags 返回 null（PGRST202 函数不存在 → 帮手 catch 返 null）；
--               · 「按用户成本 Top-N」的匿名标签【逐字回退旧行为】：同一 user_id 只要有一条
--                 匿名历史行即标匿名 —— 也就是本次要修的那个误导仍然存在；
--               · 「匿名/登录成本占比」同样回退旧行为：按每一行的 is_anonymous 标记分摊
--                 （is_anonymous 为 NULL 的行两侧都不计）；
--               · 前端卡片上会显示「口径待生效」badge + 一行说明，明确告知看的是旧口径，
--                 不静默显错数（范式同 0043/0045/0047 各段降级）。
--               跑完本迁移后无需改代码、无需重启，看板下一次刷新自动切当前身份口径。
--
--             幂等：create or replace function，可安全重跑（ACL 不被 replace 重置，见 0052 末段）。
--             ⚠️ 用 npm run db:push 应用。db-push 已按文件包 BEGIN/COMMIT，本文件不自带 begin/commit。
--             ⚠️ 本迁移由产品方本人执行；代码侧不得自动跑、不得直连生产库。
-- Created   : 2026-08-07
-- -----------------------------------------------------------------------------

-- security definer：需读 auth.users（RLS 之外的系统表），调用上下文是 service_role（看板 route）。
-- ⚠️ set search_path = public, auth, pg_temp 是提权防护 + 保证能解析 auth.users，不可省（同 0043-0047）。
-- 函数体内所有列引用一律【带表别名限定】：returns table 的列名（id / is_anonymous）在 SQL 函数里
-- 是 OUT 参数，不限定会与 auth.users 同名列歧义。
create or replace function public.get_user_anon_flags()
returns table (id uuid, is_anonymous boolean)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
select
  u.id,
  -- 「当前不是真注册用户」即算匿名（口径与 0043/0044/0045/0047 的真注册集同源）
  (u.is_anonymous is true or u.email is null or btrim(u.email) = '') as is_anonymous
from auth.users u
where exists (
  -- 只返回成本看板真正会问到的 id（在 api_usage_logs 里出现过），压小结果集
  select 1 from public.api_usage_logs l where l.user_id = u.id
)
order by u.id;
$$;

-- ⚠️【必须自带 revoke，不可省】Postgres 对新建函数默认 GRANT EXECUTE TO PUBLIC，Supabase 的
-- default privileges 还额外给 anon/authenticated —— 0043-0048 那批只写 grant 不写 revoke，
-- 结果任何人拿公开的 anon key 就能直读经营数据（2026-08-02 实测成立，见 hotfix 0052）。
-- 本函数只由 /api/dashboard 经 service_role 调用（src/lib/db/dashboard-metrics.ts 已 import
-- 'server-only'，客户端拿不到），故一律收权。
revoke execute on function public.get_user_anon_flags() from public, anon, authenticated;
grant  execute on function public.get_user_anon_flags() to service_role;

-- ── 守卫：收权后 service_role 必须仍能执行，anon 必须已不能 ──────────────────────
-- 【为什么用 has_function_privilege 而不是直接调函数】SQL Editor 以 postgres 超级用户身份执行、
-- 绕过一切 ACL，直接调必然成功、证明不了 service_role 的权限（同 0052 / 0054 的守卫思路）。
-- 本函数的失败形态是【静默】的：调用方 catch 后降级返 null，看板只会退回旧口径继续显示，
-- 没人会收到报错 —— 所以宁可在这里炸掉整个事务。
do $$
begin
  if not has_function_privilege('service_role', 'public.get_user_anon_flags()', 'execute') then
    raise exception '守卫失败：service_role 无法执行 get_user_anon_flags()，整份迁移已回滚。看板会静默停在旧身份口径，不要放行。';
  end if;
  if has_function_privilege('anon', 'public.get_user_anon_flags()', 'execute') then
    raise exception '守卫失败：anon 仍能执行 get_user_anon_flags()，收权没生效，整份迁移已回滚。';
  end if;
  raise notice '✅ 守卫通过：get_user_anon_flags() 已对 public/anon/authenticated 收权，service_role 可执行。';
end $$;
