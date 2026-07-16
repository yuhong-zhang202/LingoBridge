-- -----------------------------------------------------------------------------
-- Migration : 0012_api_usage_logs
-- Desc      : 补建 api_usage_logs 表（第三方 API 用量/成本日志）+ 索引 + RLS。
--             此表此前无建表脚本（schema 漂移）：线上已存在并在写在读，故本脚本必须幂等——
--             用 create table if not exists / create index if not exists / drop policy if exists 再建，
--             可在「表已存在」与「表不存在」两种库上安全重跑，不改动/丢失现有数据。
--             枚举类字段一律用 text + check（不建 enum 类型，规避 enum 幂等麻烦）。
-- Created   : 2026-07-12
-- -----------------------------------------------------------------------------

-- 字段严格对齐 src/lib/types.ts 的 ApiUsageLog（api-logger 直接 insert 该对象）+ dashboard 读取需求。
-- id / created_at 为 DB 生成（insert 不带），created_at 是 dashboard 时间范围过滤的唯一依据。
create table if not exists public.api_usage_logs (
  id                  uuid primary key default gen_random_uuid(),
  service             text not null check (service in ('doubao_asr','qwen_flash','qwen_plus','claude_sonnet','claude_haiku')),
  endpoint            text not null,
  usage_amount        numeric not null,                                  -- 用量（可为小数，如秒数）
  usage_unit          text not null check (usage_unit in ('tokens','seconds')),
  estimated_cost_cny  numeric not null,                                  -- 金额用 numeric 保精度
  latency_ms          integer not null,
  status              text not null check (status in ('success','error')),
  metadata            jsonb,                                             -- 可空（ApiUsageLog.metadata? 可选）
  created_at          timestamptz not null default now()
);

-- dashboard 大量按 created_at 范围/倒序查
create index if not exists api_usage_logs_created_idx on public.api_usage_logs (created_at desc);

-- 全平台成本属机密：启用 RLS。启用本身幂等，直接写。
alter table public.api_usage_logs enable row level security;

-- 写入：api-logger 用客户端 getSupabase()（匿名/登录 session，均为 authenticated 角色）insert；
-- 表无 user_id 列，允许任何已登录/匿名会话写日志。
drop policy if exists "api_usage_logs_insert" on public.api_usage_logs;
create policy "api_usage_logs_insert" on public.api_usage_logs
  for insert to authenticated with check (true);

-- 读取：全平台成本只应由 dashboard 的 service_role 读取（service_role 绕过 RLS）。
-- 故意不建 select 策略——启用 RLS 后无 select 策略即默认拒绝，普通用户 / 持 anon key 者都读不到成本数据。
-- （api-logger 的 insert 不带 .select() 读回，无需 select 权限。）
