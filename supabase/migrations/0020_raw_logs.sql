-- -----------------------------------------------------------------------------
-- Migration : 0020_raw_logs
-- Desc      : 全链路「原始输出留证」入库 —— 把 LLM 调用留证 / ASR 转写留证从本地 JSONL 文件
--             搬到数据库表，让留证在 Vercel serverless 生产上能持久化，并满足删除权 + 30 天过期。
--             两张表分别对齐 src/lib/raw-log.ts 的 LLMRawRecord / AsrRawRecord。
--             ⚠️ 两表都落【用户原文】：llm_raw_logs.messages 是完整 prompt（含故事原文）、
--                asr_raw_logs.transcript 是语音转写原文——最敏感的用户数据，靠下列 RLS「无策略即默认拒绝」
--                收归 service_role 唯一入口，并靠 pg_cron 30 天过期兜底。
--             幂等：create table/index/extension if not exists，可安全重跑（对齐 0018/0019）。
--             枚举字段用 text + check（不建 enum，规避幂等麻烦），对齐 0012/0018 同款做法。
-- Created   : 2026-07-17
-- -----------------------------------------------------------------------------

-- ── LLM 调用留证 ─────────────────────────────
-- 字段对齐 src/lib/raw-log.ts 的 LLMRawRecord + ALS 上下文（user_id / corpus_id 取自 raw-log-context，取不到为 null）。
-- id / created_at 由 DB 生成（created_at 是 30 天过期 GC 与离线统计的唯一时间依据）。
-- messages 存整份会话（jsonb）；system 为 anthropic 顶层字段、dashscope 为 null。
-- retained：金标保留批标记，本轮只预留列（默认 false）；抽存/单独同意逻辑不在本轮，GC 带 retained=false 过滤。
create table if not exists public.llm_raw_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,                                    -- 触发用户；ALS 取不到为 null
  corpus_id   uuid,                                    -- 关联语料；能拿到才带，否则 null
  label       text,                                    -- 服务标签（如 '[extract]'）
  provider    text,                                    -- 'anthropic' | 'dashscope'
  model       text,
  attempt     int,                                     -- 第几轮尝试：1=首发，≥2=失败后整批重问
  system      text,                                    -- anthropic 顶层 system；dashscope 为 null
  messages    jsonb,                                   -- 整份会话消息（完整 prompt，含故事原文）
  raw         text,                                    -- 模型原始输出
  json_text   text,                                    -- 花括号切片后的 JSON 文本
  parsed      text check (parsed in ('ok', 'fail')),   -- 该轮是否通过 parse + validate
  retained    boolean not null default false,          -- 金标保留批标记（本轮只预留）
  created_at  timestamptz not null default now()
);

create index if not exists llm_raw_logs_created_idx on public.llm_raw_logs (created_at);
create index if not exists llm_raw_logs_user_idx    on public.llm_raw_logs (user_id);
create index if not exists llm_raw_logs_corpus_idx  on public.llm_raw_logs (corpus_id) where corpus_id is not null;

-- ── ASR 转写留证 ─────────────────────────────
-- 字段对齐 src/lib/raw-log.ts 的 AsrRawRecord。只存转写文本（原文），不存音频字节（产品方 2026-07-17 拍定）。
-- guard：checkTranscriptUsable 结论——'ok'=可用返回，'reject'=被判为空/无效（被判掉的内容也如实留证）。
create table if not exists public.asr_raw_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,                                   -- 触发用户；ALS 取不到为 null
  corpus_id    uuid,                                   -- 关联语料；能拿到才带，否则 null
  request_id   text,                                   -- 本次 ASR 请求的 X-Api-Request-Id
  log_id       text,                                   -- 豆包返回的 X-Tt-Logid，供对账
  format       text,                                   -- 送豆包的音频格式（wav / mp3 / ogg-opus）
  status_code  text,                                   -- 豆包 X-Api-Status-Code（'20000000' 为成功）
  transcript   text,                                   -- 转写原文（含被 guard 判掉的内容本身）
  guard        text check (guard in ('ok', 'reject')), -- checkTranscriptUsable 结论
  retained     boolean not null default false,         -- 金标保留批标记（本轮只预留）
  created_at   timestamptz not null default now()
);

create index if not exists asr_raw_logs_created_idx on public.asr_raw_logs (created_at);
create index if not exists asr_raw_logs_user_idx    on public.asr_raw_logs (user_id);
create index if not exists asr_raw_logs_corpus_idx  on public.asr_raw_logs (corpus_id) where corpus_id is not null;

-- ── RLS：唯一入口收归 service_role ─────────────────────────────
-- 启用 RLS（启用本身幂等）。故意【不建任何策略】——启用 RLS 后无策略即默认拒绝：
-- 客户端持 anon key 直连一律读写不进，写入/删除唯一走服务端 service_role（src/lib/raw-log.ts，绕 RLS）。
-- 对齐 0018 flow_events 的「无策略即默认拒绝」做法。留证含用户原文，此层是隐私的第一道闸。
alter table public.llm_raw_logs enable row level security;
alter table public.asr_raw_logs enable row level security;

-- ── 30 天过期：pg_cron 每日删除 ─────────────────────────────
-- ⚠️ Supabase 可能需先在控制台 Database → Extensions 手动启用 pg_cron 扩展；
--    托管环境里 create extension 可能因权限受限而报错，此时请由部署方在控制台启用后再重跑本迁移。
-- GC 只删 retained=false（金标保留批 retained=true 不受 30 天过期约束，长期留存）。
-- 账号删除时的「彻底删」不走这里，走 src/lib/raw-log.ts:deleteUserRawLogs（不带 retained 过滤）。
create extension if not exists pg_cron;

-- 幂等：先 unschedule 同名任务（不存在则跳过，用 DO 块——PostgreSQL 的 SELECT 不支持无 FROM 的 WHERE），
-- 再 schedule 建当日任务，可安全重跑。
do $$
begin
  if exists (select 1 from cron.job where jobname = 'raw_logs_gc_llm') then
    perform cron.unschedule('raw_logs_gc_llm');
  end if;
  if exists (select 1 from cron.job where jobname = 'raw_logs_gc_asr') then
    perform cron.unschedule('raw_logs_gc_asr');
  end if;
end $$;

select cron.schedule(
  'raw_logs_gc_llm',
  '17 3 * * *',   -- 每日 03:17（错峰）
  $$delete from public.llm_raw_logs where created_at < now() - interval '30 days' and retained = false$$
);
select cron.schedule(
  'raw_logs_gc_asr',
  '27 3 * * *',   -- 每日 03:27（与 llm 错开）
  $$delete from public.asr_raw_logs where created_at < now() - interval '30 days' and retained = false$$
);
