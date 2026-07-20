-- -----------------------------------------------------------------------------
-- Migration : 0025_consent_audit
-- Desc      : 同意记录的「最小化审计痕迹」—— 删号时在硬删 public.consent_records 之前，
--             先往本表写一条【不含任何可识别信息】的痕迹，用于日后自证「该用户确实看过
--             并同意过某版本的披露范围」。
--             背景：0022 起删号=撤回同意，删号时硬删 consent_records（产品方 2026-07-18 决策4）。
--             但那是我们向监管举证的唯一凭据 —— 用户注销后若申诉「你们当初没告诉我要拿我
--             数据做什么」，我们无法自证。故改为行业常见做法：原始记录照删，另留去标识化痕迹。
--             ⚠️ 数据库改动，需部署方手动跑（形态同 0020/0021/0022/0023）：Supabase 控制台 SQL Editor 执行。
--             幂等：create table / index 均 if not exists，可安全重跑。
--
--             ⚠️【上线前置条件】本功能依赖环境变量 CONSENT_HASH_SALT（服务端专用，绝不加
--             NEXT_PUBLIC_ 前缀）。产品方须先在 Zeabur 配好该变量，删号链路才会写本表。
--             未配置时删号路由会【直接中止并报 500】（在做任何删除动作之前中止，账号与数据
--             完好无损，用户重试即可），故本变量缺失 = 线上删号功能整体不可用，必须先配。
--             salt 一旦启用【不可更换】：换 salt 会让此前写入的 email_hash 全部失配、无法再比对。
-- Created   : 2026-07-20
-- -----------------------------------------------------------------------------

-- email_hash：sha256(lower(btrim(email)) || CONSENT_HASH_SALT) 的十六进制串，由服务端计算后写入。
--   为什么哈希邮箱而不是存 user_id：申诉者能报出的是自己的邮箱，报不出 uuid。
--   【能被验证才有意义】—— 他报邮箱，我们同法哈希一次比对，即可证明「此人曾在某时同意过某版本」。
--   为什么加 salt：邮箱空间小，裸 sha256 可被彩虹表反查回明文邮箱，加 salt 后本表不再是可识别信息。
--   salt 只存在于环境变量，【绝不落库、绝不进 git】。
-- ⚠️ 匿名账号（从未注册、无邮箱）不写本表：无邮箱即无从比对，写一行空壳痕迹既无举证价值也无必要。
-- 无 user_id / 无外键 / 无原文 / 无 ip / 无 user_agent —— 本表【刻意不含任何可回指自然人的字段】，
-- 这正是它能在账号删除后继续保留的前提。
create table if not exists public.consent_audit (
  id              uuid primary key default gen_random_uuid(),
  email_hash      text        not null,           -- 加盐 sha256（十六进制），唯一的比对入口
  consent_version int,                            -- 当时同意的披露版本（= BETA_PRIVACY_VERSION）
  granted_at      timestamptz not null,           -- 原 consent_records.agreed_at，同意发生的时刻
  revoked_at      timestamptz not null,           -- 撤回时刻 = 删号时刻（删号即撤回，决策5）
  created_at      timestamptz not null default now()
);

-- 检索索引：申诉核验的唯一查询路径就是「拿邮箱哈希反查有无痕迹」。
create index if not exists consent_audit_email_hash_idx on public.consent_audit (email_hash);

-- ── RLS：默认拒绝一切客户端访问 ─────────────────────────────────────
-- 启用 RLS 且【故意不建任何 policy】=== 客户端（anon / authenticated）读写全部被拒，
-- 仅 service_role 绕 RLS 可读写（与 0023 beta_allowlist、0014 api_usage_logs 同款处理）。
-- 本表虽已去标识化，仍是合规举证材料，没有任何让客户端触碰的理由。
alter table public.consent_audit enable row level security;
