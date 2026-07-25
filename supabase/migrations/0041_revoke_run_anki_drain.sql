-- -----------------------------------------------------------------------------
-- Migration : 0041_revoke_run_anki_drain
-- Desc      : 收紧 0040 的 run_anki_drain() 执行权限（最小权限）。
--   0040 建的 run_anki_drain 是 security definer（需绕 RLS 读锁死的 _anki_drain_config），
--   而 Postgres 建函数默认 EXECUTE TO PUBLIC → 任何持 anon key 的客户端可经 PostgREST
--   `POST /rest/v1/rpc/run_anki_drain` 触发 DB 反复向 drain 端点发 HTTP（DoS 放大面）。
--   非秘钥泄漏（函数返回 void、不回吐 secret；配置表 RLS 无策略、客户端读写全拒），但应堵。
--   收回 public/anon/authenticated 的执行权，只留 cron 属主（postgres）+ service_role。
--   pg_cron 的 anki_drain 任务由 postgres 调度、以属主执行，不受影响。
-- Created   : 2026-07-25
-- Note      : 用 `npm run db:push` 应用。
-- -----------------------------------------------------------------------------

revoke execute on function public.run_anki_drain() from public;
revoke execute on function public.run_anki_drain() from anon;
revoke execute on function public.run_anki_drain() from authenticated;
grant  execute on function public.run_anki_drain() to service_role;
