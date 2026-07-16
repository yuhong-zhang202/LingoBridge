-- -----------------------------------------------------------------------------
-- Migration : 0013_anon_restructure_counts
-- Desc      : 匿名用户「每日整理次数」计数表 + 原子递增 RPC + RLS。
--             restructure 接口不落库，无法靠 corpus/复练那样的既有行计数；api_usage_logs 又无 user_id 列
--             （见 0012），无法按用户反查——故新建专用计数表（比反查最终一致的成本日志更稳、无并发偏差）。
--             幂等：create table/function if not exists / or replace，可安全重跑。
-- Created   : 2026-07-12
-- -----------------------------------------------------------------------------

create table if not exists public.anon_restructure_counts (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  day      date not null default current_date,
  count    integer not null default 0,
  primary key (user_id, day)
);

-- 计数属额度控制数据：启用 RLS 且不建任何策略 → anon/authenticated 默认拒绝读写（防用户自行篡改试用额度）。
-- 只有 route 用的 service_role 绕过 RLS 读写（经下方 RPC）。
alter table public.anon_restructure_counts enable row level security;

-- 原子递增某用户当日计数并返回递增后的值（供 restructure route 判匿名整理额度，避免读-改-写并发偏差）。
create or replace function public.bump_anon_restructure(p_user_id uuid)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into public.anon_restructure_counts (user_id, day, count)
    values (p_user_id, current_date, 1)
    on conflict (user_id, day) do update set count = anon_restructure_counts.count + 1
    returning count into v_count;
  return v_count;
end;
$$;
