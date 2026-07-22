-- Migration : 0028_revoked_users
-- Desc      : 令牌吊销名单 —— 本地验签(jwt-verify.ts)不查即时吊销，封号/删号后用户手里的 access token
--             靠本地验签仍会通过、最长存活到 exp（默认 1h）。此表补上「≤60s 吊销」的兜底：
--             api-auth 的 authUser 在验签通过后，再查 sub 是否在本表（60s 进程内缓存，几乎零开销），
--             在表内 → 401。封号/删号时往本表插一行即可（删号路由已自动插）。
--             幂等：create table if not exists，可安全重跑。
create table if not exists public.revoked_users (
  user_id    uuid        primary key,          -- 被吊销用户的 auth.users.id（= JWT 的 sub）
  reason     text,                              -- 'account_deleted' / 'banned' 等，仅备查
  revoked_at timestamptz not null default now()
);

comment on table public.revoked_users is '令牌吊销名单：封号/删号用户 id；api-auth 验签后查此表拦截存活 token（≤60s 生效）。token 过期后行可清（pg_cron 可选）。';

-- 启用 RLS 且【故意不建任何 policy】= 客户端(anon/authenticated)读写全拒，仅 service_role 可读写。
-- 同 beta_allowlist(0023) 范式：吊销名单绝不可被普通用户读/改。
alter table public.revoked_users enable row level security;
