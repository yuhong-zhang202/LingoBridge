-- -----------------------------------------------------------------------------
-- Migration : 0052_hotfix_revoke_anon_access
-- Desc      : 安全 hotfix —— 两条经【生产实测确认已成立】的越权读，一并收口。
--
--   ① 8 个经营指标 security definer RPC 对 anon 开放。
--      PG 对新建函数默认 GRANT EXECUTE TO PUBLIC，Supabase 的 default privileges 又额外给了
--      anon=X / authenticated=X；而 0043-0048 只写了 grant to service_role、【没有先 revoke】。
--      后果：任何人持浏览器里公开的 NEXT_PUBLIC_SUPABASE_ANON_KEY，未登录即可
--      POST /rest/v1/rpc/get_retention_stats 直读经营数据，绕过 /api/dashboard 的 requireAdmin 闸。
--      实测（2026-08-02）：8 个全部 200，取到真实留存率 / 注册总数 / 逐日注册明细 / 激活率。
--
--   ② avatars 桶的 SELECT 策略对 public 角色开放，而 storage 的 list API 走 storage.objects 的
--      SELECT 策略。后果：任何人 POST /storage/v1/object/list/avatars 即可枚举出【全部有头像用户
--      的 user_id】（路径首段就是 user_id，见 0008 与 src/lib/db/avatar.ts），再拼公开 URL 批量
--      下载人脸照片。实测（2026-08-02）：anon 枚举成功返回 UUID 目录名。
--
--      ⚠️ 修复边界，别对外说成「头像变私密了」：本次砍掉的是攻击链第一环「不知道 user_id 也能
--      列出全部 user_id」。已知完整路径的头像仍可公开访问 —— 那是产品要的公开外链设计。
--      user_id 是 uuid v4、不可枚举不可猜，第一环断了整条链就断。
--
--   幂等：revoke 对已无权限者不报错；drop policy if exists 可安全重跑。
--   ⚠️ 部署方须在 Supabase 控制台 SQL Editor 手动跑（形态同 0018-0023、0043-0051）。
--      【整份文件包在 begin/commit 里，中途任何一步失败会整体回滚，不会留下半套状态。】
--
--   ⚠️⚠️ 给未来的人：本文件收的权，会在函数被【drop 后重建】或【改签名新建】时丢失并恢复默认
--        PUBLIC EXECUTE（create or replace 不重置 ACL，故改口径重跑 0043-0048 是安全的）。
--        任何新增 security definer 函数，必须【自带 revoke】——不要照抄 0043-0048 那批只写
--        grant 的旧范式，那正是本 hotfix 要修的根因。参考现成正确范式：0041。
-- Created   : 2026-08-02
-- -----------------------------------------------------------------------------

begin;

-- ── ① 经营指标 RPC 收权 ────────────────────────────────────────────────────────
-- 全部只由 /api/dashboard 经 service_role 调用（src/lib/db/dashboard-metrics.ts 已 import 'server-only'，
-- client 类型写死 service_role；dashboard/page.tsx 只走 apiFetch('/api/dashboard')）→ 收权后看板不受影响。
-- 签名以 pg_proc 实测为准（8 个函数均为单一签名 (p_window_days integer)、无重载）。
-- 【刻意不动】enforce_beta_allowlist() / handle_new_user()：两者 returns trigger、PostgREST 不暴露
--   （实测调用返回 PGRST202），收权收益为零；而前者是内测注册白名单主闸，风险收益不对称。

revoke execute on function public.get_retention_stats(int)         from public, anon, authenticated;
revoke execute on function public.get_registration_stats(int)      from public, anon, authenticated;
revoke execute on function public.get_daily_registrations(int)     from public, anon, authenticated;
revoke execute on function public.get_active_registered_stats(int) from public, anon, authenticated;
revoke execute on function public.get_core_active_stats(int)       from public, anon, authenticated;
revoke execute on function public.get_window_core_active(int)      from public, anon, authenticated;
revoke execute on function public.get_activation_stats(int)        from public, anon, authenticated;
revoke execute on function public.get_weekly_retention_stats(int)  from public, anon, authenticated;

-- 重新确认 service_role 仍可执行（上面的 revoke 不触及它；此处为幂等与防呆，重复 grant 无副作用）
grant execute on function public.get_retention_stats(int)          to service_role;
grant execute on function public.get_registration_stats(int)       to service_role;
grant execute on function public.get_daily_registrations(int)      to service_role;
grant execute on function public.get_active_registered_stats(int)  to service_role;
grant execute on function public.get_core_active_stats(int)        to service_role;
grant execute on function public.get_window_core_active(int)       to service_role;
grant execute on function public.get_activation_stats(int)         to service_role;
grant execute on function public.get_weekly_retention_stats(int)   to service_role;

-- ── 守卫：收权后 service_role 必须仍能执行，anon 必须已不能 ──────────────────────
-- 【为什么用 has_function_privilege 而不是直接 select 一次函数】
--   SQL Editor 以 postgres 超级用户身份执行，superuser 绕过一切 ACL 检查 —— 直接调函数【必然成功】，
--   证明不了 service_role 的权限。has_function_privilege 是按指定角色查 ACL，才是真检查。
-- 这道守卫是本次 hotfix 唯一「错了不会立刻响」的地方的兜底：那批 fetcher 在 dashboard-metrics.ts 里
--   出错一律 return null、前端显「待接入」而不报错，若 service_role 真被收掉，看板不会 500、
--   只会悄悄全变成「待接入」，可能几天没人发现。宁可在这里炸掉整个事务。
do $$
declare
  fn text;
  fns text[] := array[
    'public.get_retention_stats(int)',        'public.get_registration_stats(int)',
    'public.get_daily_registrations(int)',    'public.get_active_registered_stats(int)',
    'public.get_core_active_stats(int)',      'public.get_window_core_active(int)',
    'public.get_activation_stats(int)',       'public.get_weekly_retention_stats(int)'
  ];
begin
  foreach fn in array fns loop
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception '守卫失败：service_role 失去了 % 的执行权，整份迁移已回滚。看板会静默变「待接入」，不要放行。', fn;
    end if;
    if has_function_privilege('anon', fn, 'execute') then
      raise exception '守卫失败：anon 仍能执行 %，收权没生效，整份迁移已回滚。', fn;
    end if;
  end loop;
  raise notice '✅ 守卫通过：8 个经营指标 RPC —— service_role 可执行、anon 已收权。';
end $$;

-- ── ② avatars 桶：删掉「所有人可 SELECT」策略，堵住目录枚举 ──────────────────────
-- 【为什么删了头像还能显示】public bucket 的读取端点（/object/public/... 与 /object/...）由 storage-api
--   按 bucket.public=true 短路放行，【不走 storage.objects 的 RLS】——已用同构对照桶实测确认
--   （零 SELECT 策略下匿名 GET /object/public/ 仍 200，且不带任何 apikey 也 200）。
--   故本策略只服务于 list 枚举，删之无损显示。
-- 【被本策略保护的其余操作不受影响，均已实测】
--   · 上传走 avatars_owner_insert（零 SELECT 策略下 authenticated 上传仍 200，往他人文件夹仍被挡）
--   · 换头像路径是 {userId}/{Date.now()}.{ext}，永远是新文件、永远走 INSERT，不触发 SELECT/UPDATE
--   · 删号清理走 service_role 的 list+remove（实测正常）—— 被遗忘权兜底不受影响
--   · 全项目只有删号 route 用 list，前端无任何 list 头像的代码
-- 【回滚】create policy "avatars_public_read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars_public_read" on storage.objects;

commit;
