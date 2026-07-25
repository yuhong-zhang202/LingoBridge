-- -----------------------------------------------------------------------------
-- Migration : 0042_revoked_users_ttl
-- Desc      : 令牌吊销名单（revoked_users，0028）加 TTL GC —— 吊销墓碑此前【永不清理】，
--             而 access token 最长 ~1h 即失效、之后名单行已无用，却长期留着一份「已注销/封禁 auth uuid
--             全名单」。本迁移用 pg_cron 每日清超期行，让墓碑用完即焚，收敛留存面。
--
--   7 天阈值：远大于 token 最长有效期（默认 1h），留足冗余——即便 cron 漏跑几天，也绝不会在 token 仍
--             可能存活时误删其吊销行（误删 = 该 token 在剩余寿命里恢复可用，故阈值必须 >> token 寿命）。
--
--   时间列复用 revoked_at（0028 已有：timestamptz not null default now()，即写入/吊销时间）——
--   它语义上正是「该行创建时间」，无需再加冗余 created_at 列，GC 直接按 revoked_at 判超期。
--
--   幂等：DO 块先 unschedule 同名任务再 schedule（对齐 0020 raw_logs_gc / 0040 anki_drain 范式），
--         可安全重跑、可从零按序跑。pg_cron 扩展在 0020 已 create extension if not exists，此处不再重复装。
-- Created   : 2026-07-25
-- -----------------------------------------------------------------------------

-- 防呆：0028 已建 revoked_at；万一在某些环境缺列，补一列（if not exists 幂等），保证下面 GC 的列存在。
alter table public.revoked_users
  add column if not exists revoked_at timestamptz not null default now();

-- 每日删除超 7 天的吊销行（token 早已过期，墓碑无用）。
-- 幂等：先 unschedule 同名任务（不存在则跳过，用 DO 块——SELECT 不支持无 FROM 的 WHERE），再 schedule。
do $$
begin
  if exists (select 1 from cron.job where jobname = 'revoked_users_gc') then
    perform cron.unschedule('revoked_users_gc');
  end if;
end $$;

select cron.schedule(
  'revoked_users_gc',
  '37 3 * * *',   -- 每日 03:37（与 raw_logs_gc 03:17/03:27 错峰）
  $$delete from public.revoked_users where revoked_at < now() - interval '7 days'$$
);
