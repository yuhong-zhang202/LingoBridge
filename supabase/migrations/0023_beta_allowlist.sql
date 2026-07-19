-- -----------------------------------------------------------------------------
-- Migration : 0023_beta_allowlist
-- Desc      : 【内测临时措施·用完即弃】邮箱白名单准入闸。
--             背景：注册/登录由客户端直连 Supabase GoTrue（无 Next API 路由、无 middleware），
--             且注册实为 updateUser({email,password}) 把邮箱绑到匿名账号（非 signUp），
--             故 Auth Hook(Before User Created) 不触发 → 准入只能挡在 DB 层的 auth.users 触发器。
--             匿名试用一律放行（匿名账号无邮箱）。
--             ⚠️ 数据库改动，需部署方手动跑（形态同 0020/0021/0022）：Supabase 控制台 SQL Editor 执行。
--             幂等：create table / or replace function / drop+create trigger，可安全重跑。
--             ⚠️ 本文件【不含任何真实邮箱】（敏感数据不进 git）。
--             上线后第一步：在 Table Editor 往 public.beta_allowlist 插入产品方自己的邮箱，再插其他内测者。
-- Created   : 2026-07-19
-- -----------------------------------------------------------------------------

-- email 作主键：同一邮箱只有一行。比对时两侧都 lower()，故大小写不一致仍可匹配。
-- 哨兵行 email = '*' ：存在即【停用白名单】（拆除开关，零部署零改 SQL）。
create table if not exists public.beta_allowlist (
  email      text primary key,
  note       text,                                     -- 备注：谁、何时加的（可空）
  created_at timestamptz not null default now()
);

-- ── RLS：默认拒绝一切客户端访问 ─────────────────────────────────────
-- 启用 RLS 且【故意不建任何 policy】=== 客户端（anon / authenticated）读写全部被拒，
-- 仅 service_role 绕 RLS 可读写（与 0014 对 api_usage_logs 的处理一致）。
-- 名单本身绝不能让客户端读到：否则等于公开内测者邮箱名单，是隐私问题。
alter table public.beta_allowlist enable row level security;

-- ── 准入触发器函数 ────────────────────────────────────────────────
-- security definer：需要读 public.beta_allowlist，而触发上下文可能是低权限角色。
-- ⚠️ set search_path = public, pg_temp 是提权防护（禁止调用方用临时 schema 劫持表名解析），不可省。
create or replace function public.enforce_beta_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_email text;
begin
  -- 1) 本次要校验的邮箱：email 与 email_change 两个字段都查。
  --    ⚠️ Secure email change 开关状态不确定：开启时新邮箱先落 email_change、确认后才进 email；
  --    两字段都查可无视该开关差异。
  target_email := coalesce(new.email, new.email_change);

  -- 2) 匿名账号（无邮箱）→ 放行，不影响未注册试用。
  if target_email is null or btrim(target_email) = '' then
    return new;
  end if;

  -- 3) 防呆兜底：表为空视为「白名单未启用」，避免误删全部行把产品方自己也锁死。
  if not exists (select 1 from public.beta_allowlist) then
    return new;
  end if;

  -- 4) 拆除开关：存在哨兵行 '*' → 白名单停用，全部放行。
  if exists (select 1 from public.beta_allowlist where email = '*') then
    return new;
  end if;

  -- 5) 不在名单内 → 拒绝。
  --    错误消息内含稳定关键词 BETA_ALLOWLIST_DENIED，供前端（src/lib/auth.ts）映射为明确文案。
  if not exists (
    select 1 from public.beta_allowlist where lower(email) = lower(target_email)
  ) then
    raise exception 'BETA_ALLOWLIST_DENIED: email not in beta allowlist';
  end if;

  -- 6) 在名单内 → 放行。
  return new;
end;
$$;

-- ⚠️ of email, email_change 限定列：仅当这两列被写入时才触发。
-- 否则会误伤改昵称/头像/备考目标/改密码等其它 updateUser 调用
-- （src/lib/auth.ts:116/167/185、src/lib/db/avatar.ts）。
drop trigger if exists enforce_beta_allowlist_trg on auth.users;
create trigger enforce_beta_allowlist_trg
  before insert or update of email, email_change on auth.users
  for each row execute function public.enforce_beta_allowlist();

-- ── 内测结束拆除（届时单独执行，不在本文件自动跑）────────────────────
--   drop trigger if exists enforce_beta_allowlist_trg on auth.users;
--   drop function if exists public.enforce_beta_allowlist();
--   drop table if exists public.beta_allowlist;
