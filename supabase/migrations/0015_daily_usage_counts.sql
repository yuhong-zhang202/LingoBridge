-- -----------------------------------------------------------------------------
-- Migration : 0015_daily_usage_counts
-- Desc      : 通用「每日用量计数」表 + 原子递增 RPC + RLS（把 0013 的匿名整理计数思路泛化到多接口）。
--             practice/polish/pronounce/transcribe 四个付费接口需在服务端按 (user_id, 当日, kind) 计次，
--             用于匿名试用上限与注册用户熔断上限——纯服务端 service_role 经 RPC 写读，客户端伪造无法绕过。
--             幂等：create table/function if not exists / or replace，可安全重跑。
-- Created   : 2026-07-12
-- -----------------------------------------------------------------------------

create table if not exists public.daily_usage_counts (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  day      date not null default current_date,
  kind     text not null,                         -- 用量类别：practice / polish / pronounce / transcribe ...
  count    integer not null default 0,
  primary key (user_id, day, kind)
);

-- 计数属额度控制数据：启用 RLS 且不建任何策略 → anon/authenticated 默认拒绝读写（防用户自行篡改额度）。
-- 只有 route 用的 service_role 绕过 RLS 读写（经下方 RPC）。
alter table public.daily_usage_counts enable row level security;

-- 原子递增某用户当日某类计数并返回递增后的值（避免读-改-写并发偏差）；逻辑对齐 0013 的 bump_anon_restructure。
create or replace function public.bump_daily_usage(p_user_id uuid, p_kind text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into public.daily_usage_counts (user_id, day, kind, count)
    values (p_user_id, current_date, p_kind, 1)
    on conflict (user_id, day, kind) do update set count = daily_usage_counts.count + 1
    returning count into v_count;
  return v_count;
end;
$$;
