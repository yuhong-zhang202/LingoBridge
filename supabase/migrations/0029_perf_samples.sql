-- Migration : 0029_perf_samples
-- Desc      : 性能埋点样本表 —— 把服务端关键耗时（如 /api/consent 的验签/插库分段）落库，
--             供事后直接 SQL 查「冷 vs 热」分布，免手动 DevTools 截图。
--             写入为 fire-and-forget（不阻塞业务响应）。通用结构：一次操作的每个 phase 落一行。
--             幂等：create table if not exists，可安全重跑。
create table if not exists public.perf_samples (
  id         bigint generated always as identity primary key,
  label      text        not null,          -- 埋点点名，如 'consent'
  phase      text        not null,          -- 阶段，如 'auth' | 'insert'
  ms         integer     not null,          -- 该阶段耗时（毫秒）
  meta       jsonb,                          -- 附加信息，如 { "is_anonymous": true }
  created_at timestamptz not null default now()
);

create index if not exists perf_samples_label_created_idx on public.perf_samples (label, created_at desc);

comment on table public.perf_samples is '性能埋点样本：服务端关键耗时分段。用于查冷/热延迟分布，免手动截图。可按需 pg_cron 定期清理旧样本。';

-- 启用 RLS 且【故意不建任何 policy】= 客户端读写全拒，仅 service_role 写入/读取（同 beta_allowlist 范式）。
alter table public.perf_samples enable row level security;
