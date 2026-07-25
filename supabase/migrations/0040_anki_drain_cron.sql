-- -----------------------------------------------------------------------------
-- Migration : 0040_anki_drain_cron
-- Desc      : Anki 卡背生成 drain 端点的定时触发（方案 §1「香港 PaaS 常驻/cron」的 DB 侧实现）。
--             入队的生成任务（0031）需要有人周期性 POST /api/anki/generate/drain 才会被处理，
--             否则用户绑了语料也永远等不到卡背。本迁移用 pg_cron（已装，见 0020）+ pg_net 每 2 分钟
--             异步 POST drain 端点。端点自身幂等（claim 用 FOR UPDATE SKIP LOCKED），与任何额外
--             触发源（如 VPS crontab）并发安全，不会重复处理同一单。
--
--   秘钥不入 git：drain 端点要求请求头 x-anki-drain-secret == env.ANKI_DRAIN_SECRET（fail-closed 401）。
--     秘钥与 URL 存进【RLS 锁死】的 _anki_drain_config（仅 service_role/表主可读、客户端全拒，
--     同 0023 beta_allowlist / 0029 perf_samples 范式），由运维用一条 INSERT 填入（见部署文档），
--     绝不写进本迁移文件。表空/秘钥未填时 run_anki_drain 静默跳过、不刷错误。
--
--   反压：cron 每 2 分钟触发一次；drain 单次最多领 ANKI_DRAIN_BATCH(5) 条、按 user 分桶串行 + 全局限并发，
--     故「每 2 分钟一拨」对内测量级足够，且 http_post 是 fire-and-forget（不阻塞 cron）。
--
--   回滚：select cron.unschedule('anki_drain');  drop function public.run_anki_drain();
--         drop table public._anki_drain_config;  （pg_net 扩展保留无害）
-- Created   : 2026-07-25
-- Note      : 用 `npm run db:push` 应用（幂等、记 _schema_migrations）。
-- -----------------------------------------------------------------------------

-- pg_net：DB 侧异步 HTTP（Supabase 官方可用扩展）
create extension if not exists pg_net;

-- 私有配置表：单行，存 drain URL + secret。RLS 启用且【故意不建任何 policy】= 客户端
-- (anon/authenticated) 读写全拒，仅 service_role / 表主 / security definer 函数可读。
create table if not exists public._anki_drain_config (
  id           smallint primary key default 1 check (id = 1),  -- 恒单行
  drain_url    text not null,
  drain_secret text not null,
  updated_at   timestamptz not null default now()
);
alter table public._anki_drain_config enable row level security;

-- 触发函数：读配置 → 异步 POST drain 端点。security definer 以便在低权限触发上下文里读配置表。
-- set search_path 固定防表名劫持（同项目其余 security definer 范式）。
create or replace function public.run_anki_drain()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg public._anki_drain_config;
begin
  select * into cfg from public._anki_drain_config where id = 1;
  -- 未配置（部署前 / 秘钥未填）→ 静默跳过，不报错刷屏
  if not found or coalesce(cfg.drain_secret, '') = '' or coalesce(cfg.drain_url, '') = '' then
    return;
  end if;
  perform net.http_post(
    url     := cfg.drain_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-anki-drain-secret', cfg.drain_secret
    ),
    timeout_milliseconds := 8000
  );
end;
$$;

-- 每 2 分钟触发一次（cron.schedule 同名重跑会更新，幂等）
select cron.schedule('anki_drain', '*/2 * * * *', $$select public.run_anki_drain()$$);
