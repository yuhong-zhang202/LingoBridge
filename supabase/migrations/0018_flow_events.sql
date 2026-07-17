-- -----------------------------------------------------------------------------
-- Migration : 0018_flow_events
-- Desc      : 内测埋点事件表 flow_events —— 全链路留痕：观察点分布 / 假空率 / 「真实故事数」分母 /
--             「服务端给了什么 vs 用户真看到什么」。第一周只出裸计数与分布、不设阈值。
--             幂等：create table/index if not exists + drop policy if exists 再建，可安全重跑。
--             枚举字段用 text + check（不建 enum，规避幂等麻烦），对齐 0012_api_usage_logs 同款做法。
-- Created   : 2026-07-17
-- -----------------------------------------------------------------------------

-- 字段对齐 src/lib/events.ts 的 logEvent（服务端直接 insert）。
-- id / created_at 为 DB 生成（insert 不带）；created_at 是离线统计时间范围过滤的唯一依据。
-- 隐私：props 只放计数/布尔/观察点 code，绝不含故事原文（写入侧 events.ts / api 路由已保证）。
create table if not exists public.flow_events (
  id          uuid primary key default gen_random_uuid(),
  event       text not null check (event in ('match.result','flow.corpus_bound','match.view_rendered')),
  flow_id     text,                                    -- 建语料前的环节靠它 join；可空
  story_id    uuid,                                    -- corpus.id；建语料后各环节主 join key；可空
  user_id     uuid,                                    -- 触发用户；可空
  props       jsonb not null default '{}'::jsonb,      -- 事件专属计数/布尔/code
  created_at  timestamptz not null default now()
);

-- 离线统计按时间范围/倒序、按事件名聚合查
create index if not exists flow_events_created_idx on public.flow_events (created_at desc);
create index if not exists flow_events_event_idx   on public.flow_events (event, created_at desc);

-- 启用 RLS（启用本身幂等）
alter table public.flow_events enable row level security;

-- 写入：唯一走服务端 service_role（events.ts / api 路由，service_role 绕过 RLS）。
-- 故意【不建任何 insert 策略】——启用 RLS 后无策略即默认拒绝，客户端持 anon key 直连一律写不进，
-- 杜绝客户端灌水污染统计（客户端事件 match.view_rendered 也须经 /api/events 服务端中转落库）。
-- 读取：只由离线/看板的 service_role 读——同样不建 select 策略，普通/匿名会话默认读不到。
